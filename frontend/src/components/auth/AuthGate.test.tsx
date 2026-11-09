// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "./AuthGate";
import { authApi, type AuthStatus } from "@/lib/api/auth";

vi.mock("@/lib/api/auth", () => ({ authApi: { status: vi.fn() } }));
vi.mock("./AuthPage", () => ({
  AuthPage: ({ mode }: { mode: string }) => <div>auth page: {mode}</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthGate>
        <div>the app</div>
      </AuthGate>
    </QueryClientProvider>,
  );
}

const status = (over: Partial<AuthStatus>): AuthStatus => ({
  enabled: true,
  configured: true,
  authenticated: false,
  username: null,
  ...over,
});

describe("AuthGate", () => {
  it("shows a loading state until the status arrives, and not the app", () => {
    vi.mocked(authApi.status).mockReturnValue(new Promise(() => {}));
    renderGate();
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("renders the app when authentication is off", async () => {
    vi.mocked(authApi.status).mockResolvedValue(status({ enabled: false, configured: false }));
    renderGate();
    expect(await screen.findByText("the app")).toBeTruthy();
  });

  it("renders the app when signed in", async () => {
    vi.mocked(authApi.status).mockResolvedValue(status({ authenticated: true, username: "owner" }));
    renderGate();
    expect(await screen.findByText("the app")).toBeTruthy();
  });

  it("shows the setup page when no account exists", async () => {
    vi.mocked(authApi.status).mockResolvedValue(status({ configured: false }));
    renderGate();
    expect(await screen.findByText("auth page: setup")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("shows the login page when signed out", async () => {
    vi.mocked(authApi.status).mockResolvedValue(status({}));
    renderGate();
    expect(await screen.findByText("auth page: login")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("offers a retry, and never the app, when the status cannot be read", async () => {
    vi.mocked(authApi.status).mockRejectedValue(new Error("Failed to fetch"));
    renderGate();
    await waitFor(() => expect(screen.getByText("Can't reach Parallax")).toBeTruthy());
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
