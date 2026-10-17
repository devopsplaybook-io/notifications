import { describe, expect, it } from "vitest";

import { formatTabTitle } from "../services/TabTitle";

describe("tab title", () => {
  it("prefixes the unread count while signed in", () => {
    expect(formatTabTitle(3, true)).toBe("(3) Notifications");
    expect(formatTabTitle(1, true)).toBe("(1) Notifications");
  });

  it("falls back to the base title without unread items or a session", () => {
    expect(formatTabTitle(0, true)).toBe("Notifications");
    expect(formatTabTitle(0, false)).toBe("Notifications");
    expect(formatTabTitle(5, false)).toBe("Notifications");
  });
});
