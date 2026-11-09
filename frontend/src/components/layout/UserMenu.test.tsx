// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { UserMenu } from "./UserMenu";
import { authApi, type AuthStatus } from "@/lib/api/auth";

vi.mock("@/lib/api/auth", () => ({ authApi: { status: vi.fn(), logout: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMenu(status: AuthStatus) {
  vi.mocked(authApi.status).mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UserMenu />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const base: AuthStatus = { enabled: true, configured: true, authenticated: true, username: "o" };

describe("UserMenu", () => {
  it("offers the account menu when signed in", async () => {
    renderMenu(base);
    expect(await screen.findByRole("button", { name: "Account menu" })).toBeTruthy();
  });

  it("is hidden when authentication is off", async () => {
    renderMenu({ ...base, enabled: false, authenticated: false, username: null });
    await waitFor(() => expect(authApi.status).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });
});
