// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router";
import { Settings } from "./Settings";

// The tabs fetch their own data; this test is only about which one shows and what scrolls.
vi.mock("@/components/settings/GeneralTab", () => ({
  GeneralTab: () => (
    <div id="account" tabIndex={-1}>
      general tab with the account card
    </div>
  ),
}));
vi.mock("@/components/settings/TranscodingTab", () => ({
  TranscodingTab: () => <div>transcoder</div>,
}));
vi.mock("@/components/settings/CredentialsTab", () => ({ CredentialsTab: () => <div>keys</div> }));
vi.mock("@/components/settings/ModelsTab", () => ({ ModelsTab: () => <div>ai models</div> }));
vi.mock("@/components/settings/DownloadsTab", () => ({ DownloadsTab: () => <div>downloads</div> }));
vi.mock("@/components/settings/CreditsTab", () => ({ CreditsTab: () => <div>credits</div> }));

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  cleanup();
  scrollIntoView.mockClear();
});

const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Settings />
    </MemoryRouter>,
  );

describe("Settings and the #account link", () => {
  it("scrolls the Account card into view", async () => {
    at("/settings#account");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(screen.getByText("general tab with the account card")).toBeTruthy();
  });

  it("shows General even when another tab was asked for", async () => {
    at("/settings?tab=ai#account");
    expect(screen.getByText("general tab with the account card")).toBeTruthy();
    expect(screen.queryByText("ai models")).toBeNull();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("does not scroll without the link", () => {
    at("/settings");
    expect(screen.getByText("general tab with the account card")).toBeTruthy();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("still opens the tab named in the address", () => {
    at("/settings?tab=ai");
    expect(screen.getByText("ai models")).toBeTruthy();
  });

  it("moves keyboard focus to the Account card, not just the scroll", async () => {
    at("/settings#account");
    await waitFor(() => expect(document.activeElement?.id).toBe("account"));
  });

  it("works again when the link is chosen a second time on the same address", async () => {
    render(
      <MemoryRouter initialEntries={["/settings#account"]}>
        <Settings />
        <AccountLink />
      </MemoryRouter>,
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "AI Models" })); // wander off to another tab
    expect(screen.getByText("ai models")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Account settings" })); // same #account again
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
    expect(screen.getByText("general tab with the account card")).toBeTruthy();
  });
});

/** What the header menu's "Account settings" item is: a link to /settings#account. */
function AccountLink() {
  return <Link to="/settings#account">Account settings</Link>;
}
