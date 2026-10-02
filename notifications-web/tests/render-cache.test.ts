import { beforeEach, describe, expect, it, vi } from "vitest";

const { parse, sanitize } = vi.hoisted(() => ({
  parse: vi.fn((text: string) => `<p>${text}</p>`),
  sanitize: vi.fn((html: string) => `clean:${html}`),
}));

vi.mock("marked", () => ({
  marked: { setOptions: vi.fn(), parse },
}));
vi.mock("dompurify", () => ({
  default: { sanitize },
}));

import { RenderCache } from "../services/RenderCache";

describe("render cache", () => {
  beforeEach(() => {
    RenderCache.clear();
    parse.mockClear();
    sanitize.mockClear();
  });

  it("renders and sanitizes markdown once per unchanged source", () => {
    const first = RenderCache.renderMarkdown("id-1", "**bold**");
    const second = RenderCache.renderMarkdown("id-1", "**bold**");

    expect(first).toBe("clean:<p>**bold**</p>");
    expect(second).toBe(first);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(sanitize).toHaveBeenCalledTimes(1);
  });

  it("returns empty output for empty input without rendering", () => {
    expect(RenderCache.renderMarkdown("id-2", "")).toBe("");
    expect(RenderCache.renderMarkdown("id-2", null)).toBe("");
    expect(RenderCache.renderMarkdown("id-2", undefined)).toBe("");
    expect(parse).not.toHaveBeenCalled();
  });

  it("re-renders when the source text changes for the same id", () => {
    RenderCache.renderMarkdown("id-3", "first");
    RenderCache.renderMarkdown("id-3", "second");
    expect(parse).toHaveBeenCalledTimes(2);

    expect(RenderCache.renderMarkdown("id-3", "second")).toBe(
      "clean:<p>second</p>",
    );
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("keeps entries per id and evicts the oldest past the limit", () => {
    for (let index = 0; index < 200; index += 1) {
      RenderCache.renderMarkdown(`id-${index}`, `text-${index}`);
    }

    // The 201st distinct id evicts the oldest entry (id-0) only.
    RenderCache.renderMarkdown("id-overflow", "overflow");

    parse.mockClear();
    RenderCache.renderMarkdown("id-1", "text-1");
    expect(parse).not.toHaveBeenCalled();

    RenderCache.renderMarkdown("id-0", "text-0");
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
