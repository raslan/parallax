import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatus, req, setUnauthorizedHandler } from "./client";

afterEach(() => vi.unstubAllGlobals());

/** What `req()` actually throws for a failed response. */
async function thrownBy(status: number, body: string): Promise<unknown> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
  try {
    await req("/x");
  } catch (e) {
    return e;
  }
  throw new Error("req did not throw");
}

describe("httpStatus", () => {
  it("reads the status off the error req() throws", async () => {
    expect(httpStatus(await thrownBy(409, '{"detail":"Folder is no longer empty"}'))).toBe(409);
    expect(httpStatus(await thrownBy(404, ""))).toBe(404);
    expect(httpStatus(await thrownBy(500, "boom"))).toBe(500);
  });

  it("is null for anything that is not an HTTP error", () => {
    expect(httpStatus(new Error("Failed to fetch"))).toBeNull();
    expect(httpStatus(new Error("the 409 in the middle"))).toBeNull();
    expect(httpStatus("409: as a string")).toBe(409);
    expect(httpStatus(undefined)).toBeNull();
    expect(httpStatus(null)).toBeNull();
  });
});

describe("401 handling", () => {
  afterEach(() => setUnauthorizedHandler(null));

  async function call(path: string, status: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status })),
    );
    await req(path).catch(() => {});
  }

  it("tells the app when any ordinary request is refused", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await call("/files", 401);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores a 401 from the sign-in routes, which only means a wrong password", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await call("/auth/login", 401);
    await call("/auth/setup", 401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not treat other failures as a lost session", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await call("/auth/account", 403);
    await call("/files", 500);
    expect(handler).not.toHaveBeenCalled();
  });

  it("still throws the 401 to the caller", async () => {
    setUnauthorizedHandler(() => {});
    expect(httpStatus(await thrownBy(401, '{"detail":"Not authenticated"}'))).toBe(401);
  });
});
