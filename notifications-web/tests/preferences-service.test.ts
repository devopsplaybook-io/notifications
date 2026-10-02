import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesService } from "../services/PreferencesService";

const attributes = new Map<string, string>();
let prefersDark = false;

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
  };
}

beforeEach(() => {
  attributes.clear();
  prefersDark = false;
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", createLocalStorage());
  vi.stubGlobal("window", {
    matchMedia: vi.fn(() => ({ matches: prefersDark })),
  });
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
    },
  });
});

describe("preferences service", () => {
  it("defaults to push disabled and persists explicit choices", () => {
    expect(PreferencesService.isPushEnabled()).toBe(false);

    PreferencesService.setPushEnabled(true);
    expect(PreferencesService.isPushEnabled()).toBe(true);

    PreferencesService.setPushEnabled(false);
    expect(PreferencesService.isPushEnabled()).toBe(false);
  });

  it("applies the stored theme before the system preference", () => {
    localStorage.setItem("UI_THEME", "light");
    prefersDark = true;

    PreferencesService.applyTheme();

    expect(attributes.get("data-theme")).toBe("light");
  });

  it("falls back to the system preference and toggles from it", () => {
    prefersDark = true;

    PreferencesService.applyTheme();
    expect(attributes.get("data-theme")).toBe("dark");

    PreferencesService.toggleTheme();
    expect(attributes.get("data-theme")).toBe("light");
    expect(localStorage.getItem("UI_THEME")).toBe("light");
  });
});
