const API_URL = import.meta.env.VITE_API_URL || '';

// Evento global disparado após qualquer mutacao (POST/PUT/DELETE) bem-sucedida.
// Telas que escutam esse evento refazem o fetch, mantendo os dados atualizados
// sem precisar recarregar a página (ex.: edicao via ChatBot ou outra tela).
export const DATA_CHANGED_EVENT = 'iasconta:data-changed';

export interface ApiOptions extends RequestInit {
  /** Em 401, não redireciona para /login (ex.: sondagem inicial de sessão). */
  skipAuthRedirect?: boolean;
}

export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { skipAuthRedirect, ...fetchOptions } = options;
  const isFormData = fetchOptions.body instanceof FormData;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(fetchOptions.headers as Record<string, string> || {}),
  };
  // Sessao via cookie httpOnly (JWT de 30 min, deslizante) — o navegador
  // envia o cookie automaticamente em requisicoes same-origin.
  const res = await fetch(`${API_URL}${path}`, { ...fetchOptions, headers, credentials: 'same-origin' });

  if (res.status === 401 && !skipAuthRedirect && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
    if (window.location.pathname !== '/login') window.location.href = '/login';
    throw new Error('Sessao expirada');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error || body?.message || 'Erro de conexao';
    throw new Error(message);
  }

  // Qualquer mutacao bem-sucedida invalida os dados em cache de todas as telas.
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { method, path } }));
    }
  }

  return res.json();
}
