// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthPage } from "./AuthPage";
import { authApi } from "@/lib/api/auth";
import { qk } from "@/lib/api/queryKeys";

vi.mock("@/lib/api/auth", () => ({ authApi: { login: vi.fn(), setup: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(mode: "login" | "setup") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthPage mode={mode} />
    </QueryClientProvider>,
  );
  return qc;
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("AuthPage login", () => {
  it("uses the attributes password managers look for, and focuses the username", () => {
    renderPage("login");
    const user = screen.getByLabelText("Username") as HTMLInputElement;
    const pw = screen.getByLabelText("Password") as HTMLInputElement;
    expect(user.autocomplete).toBe("username");
    expect(pw.autocomplete).toBe("current-password");
    expect(pw.type).toBe("password");
    expect(document.activeElement).toBe(user);
  });

  it("asks for both fields before sending anything", async () => {
    renderPage("login");
    submit("Sign in");
    expect(await screen.findByText("Enter your username")).toBeTruthy();
    expect(screen.getByText("Enter your password")).toBeTruthy();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it("sends the trimmed username and puts the answer in the cache", async () => {
    const status = { enabled: true, configured: true, authenticated: true, username: "owner" };
    vi.mocked(authApi.login).mockResolvedValue(status);
    const qc = renderPage("login");
    type("Username", "  owner ");
    type("Password", "hunter2hunter2");
    submit("Sign in");
    await waitFor(() => expect(qc.getQueryData(qk.auth())).toEqual(status));
    expect(authApi.login).toHaveBeenCalledWith({ username: "owner", password: "hunter2hunter2" });
  });

  it("shows the server's message in an alert, including the 429 wait", async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      new Error('429: {"detail":"Too many attempts. Try again in 8 s."}'),
    );
    renderPage("login");
    type("Username", "owner");
    type("Password", "whatever1");
    submit("Sign in");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Too many attempts. Try again in 8 s.");
  });

  it("shows and hides the password", () => {
    renderPage("login");
    const pw = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(pw.type).toBe("password");
  });

  it("tells a forgetful owner how to reset", () => {
    renderPage("login");
    expect(screen.getByText(/python -m app\.reset_password/)).toBeTruthy();
  });
});

describe("AuthPage setup", () => {
  it("asks to confirm the password and uses new-password", () => {
    renderPage("setup");
    expect((screen.getByLabelText("Password") as HTMLInputElement).autocomplete).toBe(
      "new-password",
    );
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).autocomplete).toBe(
      "new-password",
    );
  });

  it.each([
    ["short", "Use at least 8 characters"],
    ["x".repeat(129), "Use at most 128 characters"],
  ])("checks the length only (%#)", async (password, message) => {
    renderPage("setup");
    type("Username", "owner");
    type("Password", password);
    type("Confirm password", password);
    submit("Create account");
    expect(await screen.findByText(message)).toBeTruthy();
    expect(authApi.setup).not.toHaveBeenCalled();
  });

  it("flags a mismatch", async () => {
    renderPage("setup");
    type("Username", "owner");
    type("Password", "correct horse battery");
    type("Confirm password", "correct horse batter");
    submit("Create account");
    expect(await screen.findByText("The passwords don't match")).toBeTruthy();
    expect(authApi.setup).not.toHaveBeenCalled();
  });

  it("re-reads the status when someone else created the account first", async () => {
    vi.mocked(authApi.setup).mockRejectedValue(
      new Error('409: {"detail":"An account already exists"}'),
    );
    const qc = renderPage("setup");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    type("Username", "owner");
    type("Password", "correct horse battery");
    type("Confirm password", "correct horse battery");
    submit("Create account");
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.auth() }));
  });

  it("accepts an all-lowercase passphrase", async () => {
    vi.mocked(authApi.setup).mockResolvedValue({
      enabled: true,
      configured: true,
      authenticated: true,
      username: "owner",
    });
    renderPage("setup");
    type("Username", "owner");
    type("Password", "four plain lowercase words");
    type("Confirm password", "four plain lowercase words");
    submit("Create account");
    await waitFor(() => expect(authApi.setup).toHaveBeenCalled());
  });
});
