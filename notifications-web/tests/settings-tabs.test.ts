import { describe, expect, it } from "vitest";

import { SettingsTabs } from "../services/SettingsTabs";

describe("settings tabs", () => {
  it("lists the profile, api-keys and email tabs in display order", () => {
    expect(SettingsTabs.map((tab) => tab.id)).toEqual([
      "profile",
      "api-keys",
      "emails",
    ]);
  });

  it("points to the settings sub-routes", () => {
    expect(SettingsTabs.map((tab) => tab.to)).toEqual([
      "/settings/profile",
      "/settings/api-keys",
      "/settings/emails",
    ]);
  });
});
