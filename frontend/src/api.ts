const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return API_BASE ? `${API_BASE}${path}` : path;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    if (text) {
      try {
        const payload = JSON.parse(text) as { detail?: string };
        if (payload.detail) {
          throw new Error(payload.detail);
        }
      } catch {
        throw new Error(text);
      }
    }
    throw new Error(`API error ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiMaybe<T>(path: string): Promise<T | null> {
  const response = await fetch(buildUrl(path), {
    credentials: 'include'
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}
