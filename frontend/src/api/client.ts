const API_URL = import.meta.env.VITE_API_URL || '';

// Evento global disparado após qualquer mutacao (POST/PUT/DELETE) bem-sucedida.
// Telas que escutam esse evento refazem o fetch, mantendo os dados atualizados
// sem precisar recarregar a página (ex.: edicao via ChatBot ou outra tela).
export const DATA_CHANGED_EVENT = 'iasconta:data-changed';

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && token) {
    localStorage.removeItem('token');
    window.location.href = '/login';
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
