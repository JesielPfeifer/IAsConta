const API_URL = import.meta.env.VITE_API_URL || '';

export async function api(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
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

  return res.json();
}
