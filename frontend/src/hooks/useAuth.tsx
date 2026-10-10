import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
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
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Sessao via cookie httpOnly: o navegador reenvia o cookie automaticamente;
    // sem sessao valida o /me responde 401 e o fluxo cai no login.
    api('/api/users/me')
      .then((data) => setUser(data.user || data))
      .catch(() => { /* sem sessao */ })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    navigate('/');
  }, [navigate]);

  const register = useCallback(async (email: string, password: string, name: string, salary?: number) => {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, salary }),
    });
    setUser(data.user);
    navigate('/');
  }, [navigate]);

  const logout = useCallback(() => {
    // Encerra a sessao no servidor (limpa o cookie) e o estado local.
    api('/api/auth/logout', { method: 'POST' }).catch(() => { /* ignore */ });
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
