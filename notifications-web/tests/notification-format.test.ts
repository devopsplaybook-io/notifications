import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractNotificationUrl,
  formatAbsoluteTime,
  formatRelativeTime,
  isHttpUrl,
  parseNotificationData,
} from "../services/NotificationFormat";

describe("formatRelativeTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty string for empty or invalid input", () => {
    expect(formatRelativeTime("")).toBe("");
    expect(formatRelativeTime("not-a-date")).toBe("");
  });

  it("buckets recent timestamps into relative units", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-10-16T12:00:00Z").getTime(),
    );
    expect(formatRelativeTime("2026-10-16T11:59:50Z")).toBe("just now");
    expect(formatRelativeTime("2026-10-16T11:59:01Z")).toBe("just now");
    expect(formatRelativeTime("2026-10-16T11:59:00Z")).toBe("1m ago");
    expect(formatRelativeTime("2026-10-16T11:35:00Z")).toBe("25m ago");
    expect(formatRelativeTime("2026-10-16T11:00:00Z")).toBe("1h ago");
    expect(formatRelativeTime("2026-10-16T06:00:00Z")).toBe("6h ago");
    expect(formatRelativeTime("2026-10-15T12:00:00Z")).toBe("1d ago");
    expect(formatRelativeTime("2026-10-13T12:00:00Z")).toBe("3d ago");
  });

  it("falls back to the absolute time string after a week", () => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-10-16T12:00:00Z").getTime(),
    );
    const old = "2026-09-01T12:00:00Z";
    expect(formatRelativeTime(old)).toBe(new Date(old).toLocaleString());
  });
});

describe("formatAbsoluteTime", () => {
  it("formats the absolute time and handles empty input", () => {
    expect(formatAbsoluteTime("")).toBe("");
    expect(formatAbsoluteTime("2026-10-16T12:00:00Z")).toBe(
      new Date("2026-10-16T12:00:00Z").toLocaleString(),
    );
  });
});

describe("parseNotificationData", () => {
  it("parses JSON strings and objects into ordered key/value entries", () => {
    expect(
      parseNotificationData('{"run":4,"nested":{"a":1},"flag":false}'),
    ).toEqual([
      ["run", "4"],
      ["nested", '{"a":1}'],
      ["flag", "false"],
    ]);
    expect(parseNotificationData({ b: "second", a: "first" })).toEqual([
      ["b", "second"],
      ["a", "first"],
    ]);
  });

  it("returns null for empty, invalid or non-object data", () => {
    expect(parseNotificationData(undefined)).toBeNull();
    expect(parseNotificationData(null)).toBeNull();
    expect(parseNotificationData("")).toBeNull();
    expect(parseNotificationData("not-json")).toBeNull();
    expect(parseNotificationData('"text"')).toBeNull();
    expect(parseNotificationData([1, 2])).toBeNull();
    expect(parseNotificationData({})).toBeNull();
  });
});

describe("extractNotificationUrl", () => {
  it("prefers data.url and falls back to the first http(s) value", () => {
    expect(extractNotificationUrl('{"url":"https://example.com/a"}')).toBe(
      "https://example.com/a",
    );
    expect(extractNotificationUrl({ url: "https://example.com/a" })).toBe(
      "https://example.com/a",
    );
    expect(
      extractNotificationUrl('{"ref":"http://example.com/b","note":"x"}'),
    ).toBe("http://example.com/b");
  });

  it("ignores non-URL and unsafe scheme values", () => {
    expect(
      extractNotificationUrl({
        url: "ftp://example.com",
        page: "https://ok.example/x",
      }),
    ).toBe("https://ok.example/x");
    expect(extractNotificationUrl('{"url":"javascript:alert(1)"}')).toBeUndefined();
    expect(extractNotificationUrl('{"a":"1","b":2}')).toBeUndefined();
    expect(extractNotificationUrl(undefined)).toBeUndefined();
    expect(extractNotificationUrl("not-json")).toBeUndefined();
  });
});

describe("isHttpUrl", () => {
  it("validates only http(s) URL strings", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
  });
});
