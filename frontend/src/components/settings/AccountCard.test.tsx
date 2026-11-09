// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountCard } from "./AccountCard";
import { authApi, type AuthStatus } from "@/lib/api/auth";
import { qk } from "@/lib/api/queryKeys";

vi.mock("@/lib/api/auth", () => ({
  authApi: { status: vi.fn(), updateAccount: vi.fn(), logoutAll: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const signedIn: AuthStatus = {
  enabled: true,
  configured: true,
  authenticated: true,
  username: "owner",
};

function renderCard(status: AuthStatus = signedIn) {
  vi.mocked(authApi.status).mockResolvedValue(status);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AccountCard />
    </QueryClientProvider>,
  );
  return qc;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

describe("AccountCard", () => {
  it("is not shown when authentication is off", async () => {
    renderCard({ ...signedIn, enabled: false, authenticated: false, username: null });
    await waitFor(() => expect(authApi.status).toHaveBeenCalled());
    expect(screen.queryByText("Account")).toBeNull();
  });

  it("asks for a change and for the current password before sending anything", async () => {
    renderCard();
    await screen.findByText("Account");
    save();
    expect(await screen.findByText("Enter your current password")).toBeTruthy();
    expect(screen.getByText("Enter a new username, a new password, or both")).toBeTruthy();
    expect(authApi.updateAccount).not.toHaveBeenCalled();
  });

  it("checks the new password's length and its confirmation", async () => {
    renderCard();
    await screen.findByText("Account");
    type("Current password", "old password");
    type("New password", "short");
    save();
    expect(await screen.findByText("Use at least 8 characters")).toBeTruthy();
    type("New password", "long enough password");
    type("Confirm new password", "something else");
    save();
    expect(await screen.findByText("The passwords don't match")).toBeTruthy();
    expect(authApi.updateAccount).not.toHaveBeenCalled();
  });

  it("sends only what changed", async () => {
    vi.mocked(authApi.updateAccount).mockResolvedValue({ ...signedIn, username: "zed" });
    const qc = renderCard();
    await screen.findByText("Account");
    type("New username", "zed");
    type("Current password", "old password");
    save();
    await waitFor(() =>
      expect(authApi.updateAccount).toHaveBeenCalledWith({
        current_password: "old password",
        new_username: "zed",
      }),
    );
    await waitFor(() => expect(qc.getQueryData(qk.auth())).toMatchObject({ username: "zed" }));
  });

  it("shows a wrong current password under the form", async () => {
    vi.mocked(authApi.updateAccount).mockRejectedValue(
      new Error('403: {"detail":"Current password is incorrect"}'),
    );
    renderCard();
    await screen.findByText("Account");
    type("New username", "zed");
    type("Current password", "nope nope");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("Current password is incorrect");
  });

  it("signs out everywhere", async () => {
    vi.mocked(authApi.logoutAll).mockResolvedValue(undefined);
    const qc = renderCard();
    await screen.findByText("Account");
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() =>
      expect(qc.getQueryData(qk.auth())).toMatchObject({ authenticated: false, username: null }),
    );
  });
});
