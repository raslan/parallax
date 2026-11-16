// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const seek = vi.fn().mockResolvedValue(0);
vi.mock("@videojs/react", () => ({ usePlayer: () => ({ seek }) }));

import { PlayerSeek } from "@/components/PlayerSeek";

afterEach(() => {
  cleanup();
  seek.mockClear();
});

describe("PlayerSeek", () => {
  it("does nothing without a request", () => {
    render(<PlayerSeek />);
    expect(seek).not.toHaveBeenCalled();
  });

  it("seeks on a new nonce, including to the same time again", () => {
    const { rerender } = render(<PlayerSeek request={{ time: 12, nonce: 1 }} />);
    expect(seek).toHaveBeenLastCalledWith(12);
    rerender(<PlayerSeek request={{ time: 12, nonce: 1 }} />);
    expect(seek).toHaveBeenCalledTimes(1);
    rerender(<PlayerSeek request={{ time: 12, nonce: 2 }} />);
    expect(seek).toHaveBeenCalledTimes(2);
  });
});
