export const BASE = "/api";

/** Pull a displayable message off an unknown thrown value. */
export function getErrorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return fallback;
}

/**
 * The HTTP status of an error thrown by `req()` (its message is `"<status>: <body>"`),
 * or null for anything else (a network failure, a non-HTTP throw).
 */
export function httpStatus(e: unknown): number | null {
  const m = /^(\d{3}): /.exec(getErrorMessage(e, ""));
  return m ? Number(m[1]) : null;
}

/** Organize answers 409 for "no folder selected" / "folder is no longer available". */
export const isConflict = (e: unknown) => httpStatus(e) === 409;

export const isMissing = (e: unknown) => httpStatus(e) === 404;

/** The 409 Organize's folder route answers while the scan is still mapping the tree: wait, not an error. */
export const isScanningConflict = (e: unknown) =>
  httpStatus(e) === 409 && errorDetail(e, "") === "scanning";

/**
 * The server's `{"detail": "..."}` message from an error thrown by `req()` (whose
 * message is `"<status>: <body>"`), else `fallback`.
 */
export function errorDetail(e: unknown, fallback: string): string {
  const body = /^\d{3}: (.*)$/s.exec(getErrorMessage(e, ""))?.[1];
  if (!body) return fallback;
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    return typeof detail === "string" && detail ? detail : fallback;
  } catch {
    return fallback;
  }
}

/** A 401 from these only means a wrong password. From any other route it means the session is gone. */
const SIGN_IN_PATHS = new Set(["/auth/login", "/auth/setup"]);

let onUnauthorized: (() => void) | null = null;

/** Registered once by `queryClient.ts`: what to do when the server says "not signed in". */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/**
 * Tell the app the session may be gone (a 401 from any request, or a dropped event stream).
 * It re-reads `/auth/status`, and `AuthGate` swaps in the login page if that now says so.
 */
export function notifyUnauthorized(): void {
  onUnauthorized?.();
}

export async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  // A 401 from the sign-in routes just means a wrong password; anywhere else it means the
  // session expired or was revoked.
  if (res.status === 401 && !SIGN_IN_PATHS.has(path)) notifyUnauthorized();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
