export class ApiException extends Error {
  constructor(public status: number, public detail: string) {
    super(`${status}: ${detail}`);
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.detail === "string") return j.detail;
    return JSON.stringify(j);
  } catch {
    return await res.text().catch(() => `${res.status} ${res.statusText}`);
  }
}

const API_BASE = "/api";

export async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  if (!res.ok) throw new ApiException(res.status, await parseError(res));

  const text = await res.text();
  return (text ? JSON.parse(text) : ({} as T)) as T;
}
