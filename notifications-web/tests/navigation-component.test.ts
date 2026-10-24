// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/Config", () => ({
  default: { get: vi.fn().mockResolvedValue({ SERVER_URL: "/api" }) },
}));

import Navigation from "../components/Navigation.vue";

// Nuxt auto-imports these stores in the app; provide minimal fakes as globals
// so the component under test resolves them the same way it does at runtime.
(globalThis as any).AuthenticationStore = () => ({
  isAuthenticated: false,
  ensureAuthenticated: vi.fn().mockResolvedValue(false),
});
(globalThis as any).NotificationsStore = () => ({
  unreadCount: 0,
  loadUnreadCount: vi.fn(),
});

function mountNavigation() {
  return mount(Navigation, {
    global: {
      mocks: { $route: { fullPath: "/" } },
      stubs: { NuxtLink: true },
    },
  });
}

describe("navigation component", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("mounts without reference errors and applies the saved theme", async () => {
    localStorage.setItem("UI_THEME", "dark");

    const wrapper = mountNavigation();
    await flushPromises();

    expect(wrapper.exists()).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("falls back to the system theme when nothing is stored", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));

    mountNavigation();
    await flushPromises();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    vi.unstubAllGlobals();
  });
});
