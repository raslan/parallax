// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Settings } from "./Settings";

// The tabs fetch their own data; this test is only about which one shows and what scrolls.
vi.mock("@/components/settings/GeneralTab", () => ({
  GeneralTab: () => <div id="account">general tab with the account card</div>,
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
});
