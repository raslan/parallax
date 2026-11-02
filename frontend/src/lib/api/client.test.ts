import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatus, req } from "./client";

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
