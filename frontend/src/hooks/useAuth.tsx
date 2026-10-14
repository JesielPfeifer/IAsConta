import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
  salary: number | null;
  partnerId: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, salary?: number) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Um login/registro pode acontecer enquanto a sondagem inicial de /me ainda
  // está no ar; a resposta atrasada dela não pode sobrescrever o usuário novo
  // nem derrubar a navegação para /login.
  const authChangedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // Sessao via cookie httpOnly: o navegador reenvia o cookie automaticamente;
    // sem sessao valida o /me responde 401 (sem redirect global — o
    // ProtectedRoute cuida da navegacao) e o fluxo cai no login.
    api('/api/users/me', { skipAuthRedirect: true })
      .then((data) => {
        if (!cancelled && !authChangedRef.current) setUser(data.user || data);
      })
      .catch(() => { /* sem sessao */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    authChangedRef.current = true;
    setUser(data.user);
    navigate('/');
  }, [navigate]);

  const register = useCallback(async (email: string, password: string, name: string, salary?: number) => {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, salary }),
    });
    authChangedRef.current = true;
    setUser(data.user);
    navigate('/');
  }, [navigate]);

  const logout = useCallback(async () => {
    // Encerra a sessao no servidor PRIMEIRO (limpa o cookie httpOnly). Se o
    // POST falhar, o cookie continua valido no navegador — manter o estado
    // local e propagar o erro evita um "logout" apenas de fachada.
    await api('/api/auth/logout', { method: 'POST' });
    authChangedRef.current = true;
    setUser(null);
    navigate('/login');
  }, [navigate]);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((cur) => (cur ? { ...cur, ...patch } : cur));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
