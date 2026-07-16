const API_URL = process.env.API_URL || 'http://api:3001';
const BOT_API_KEY = process.env.BOT_API_KEY || '';

export async function callApi<T = any>(
  path: string,
  data: any,
  method = 'POST',
): Promise<T> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-bot-api-key': BOT_API_KEY,
    },
  };

  if (method !== 'GET' && data) {
    options.body = JSON.stringify(data);
  }

  const res = await fetch(`${API_URL}${path}`, options);

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`API error ${res.status}: ${errorBody}`);
  }

  return res.json();
}
