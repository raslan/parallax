// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  target: null as unknown,
  play: vi.fn(() => Promise.resolve()),
  listeners: new Set<() => void>(),
  subscribe(l: () => void) {
    store.listeners.add(l);
    return () => store.listeners.delete(l);
  },
}));
vi.mock("@videojs/react", () => ({ usePlayer: () => store }));

import { PlayOnLoad } from "./PlayOnLoad";

describe("PlayOnLoad", () => {
  it("waits for the media element, then plays once", () => {
    store.target = null;
    store.play.mockClear();
    render(<PlayOnLoad />);
    expect(store.play).not.toHaveBeenCalled();

    store.target = {};
    store.listeners.forEach((l) => l());
    store.listeners.forEach((l) => l());
    expect(store.play).toHaveBeenCalledTimes(1);
  });

  it("plays at once when the element is already attached", () => {
    store.target = {};
    store.play.mockClear();
    render(<PlayOnLoad />);
    expect(store.play).toHaveBeenCalledTimes(1);
  });

  it("leaves the video paused when the browser refuses to autoplay", async () => {
    store.target = {};
    store.play.mockReset();
    store.play.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    render(<PlayOnLoad />);
    await Promise.resolve();
    expect(store.play).toHaveBeenCalledTimes(1);
  });
});
