import { API_BASE } from "./config";

export type ApiError = { status: number; message: string; detail?: unknown };

async function parseError(res: Response): Promise<ApiError> {
  const status = res.status;
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
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

  const text = await res.text().catch(() => "");
  if (text.trim().startsWith("<")) {
    return {
      status,
      message: "Received HTML instead of JSON. Check the /api proxy or backend route wiring.",
      detail: text.slice(0, 200),
    };
  }

  return { status, message: text || `Request failed (${status})`, detail: text };
}

export async function http<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  const hasJson = init?.json !== undefined;
  if (hasJson) headers.set("Content-Type", "application/json");

  const url =
    API_BASE
      ? `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`
      : path;

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
    body: hasJson ? JSON.stringify(init!.json) : init?.body,
  });

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }

  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw {
      status: res.status,
      message: "Received HTML instead of JSON. Check the /api proxy or backend route wiring.",
      detail: text.slice(0, 200),
    } as ApiError;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}