export const BASE = "/api";

/** Pull a displayable message off an unknown thrown value. */
export function getErrorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return fallback;
}

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
