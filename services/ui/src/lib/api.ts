import { API_BASE } from "./config";

export type ApiError = { status: number; message: string; detail?: unknown };

async function parseError(res: Response): Promise<ApiError> {
  const status = res.status;

  // FastAPI commonly returns { detail: "..." } or { detail: {...} }
  try {
    const body = await res.json();
    const msg =
      (body && typeof body === "object" && "detail" in body
        ? typeof (body as any).detail === "string"
          ? (body as any).detail
          : JSON.stringify((body as any).detail)
        : undefined) ?? `Request failed (${status})`;

    return { status, message: msg, detail: body };
  } catch {
    return { status, message: `Request failed (${status})` };
  }
}

/**
 * Single unified HTTP helper:
 * - Always calls `${API_BASE}/api${path}`
 * - Accepts init.json to send JSON body
 * - Returns JSON
 * - Throws ApiError with FastAPI detail
 */
export async function http<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const headers = new Headers(init?.headers);

  const hasJson = init?.json !== undefined;
  if (hasJson) headers.set("Content-Type", "application/json");

  // If user passes "/admin/users" we call `${API_BASE}/api/admin/users`
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...init,
    headers,
    body: hasJson ? JSON.stringify(init!.json) : init?.body,
  });

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
