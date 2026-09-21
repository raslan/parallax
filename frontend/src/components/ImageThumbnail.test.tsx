// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImageThumbnail } from "./ImageThumbnail";

afterEach(cleanup);

describe("ImageThumbnail", () => {
  it("always requests the thumbnail, even when none exists yet", () => {
    render(<ImageThumbnail imageId={7} alt="cat.png" />);
    const img = screen.getByAltText("cat.png");
    expect(img.getAttribute("src")).toBe("/api/images/7/thumbnail");
    expect(img.className).toContain("opacity-0");
  });

  it("reveals the image once it loads", () => {
    render(<ImageThumbnail imageId={7} alt="cat.png" />);
    const img = screen.getByAltText("cat.png");
    fireEvent.load(img);
    expect(img.className).not.toContain("opacity-0");
  });

  it("drops the <img> and keeps the placeholder on error", () => {
    render(<ImageThumbnail imageId={7} alt="cat.png" />);
    fireEvent.error(screen.getByAltText("cat.png"));
    expect(screen.queryByAltText("cat.png")).toBeNull();
  });
});
