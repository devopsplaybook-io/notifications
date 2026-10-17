// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onMounted, ref } from "vue";

vi.mock("../services/PushService", () => ({
  PushService: {
    listSubscriptions: vi.fn().mockResolvedValue([]),
    revokeSubscription: vi.fn().mockResolvedValue(true),
    unsubscribe: vi.fn().mockResolvedValue(true),
    isSupported: vi.fn().mockResolvedValue(false),
    getEndpointHash: vi.fn().mockResolvedValue(""),
  },
}));

import { PushService } from "../services/PushService";
import DevicesPage from "../pages/settings/devices.vue";

// Nuxt auto-imports these in the app; provide minimal fakes as globals so the
// page under test resolves them the same way it does at runtime.
(globalThis as any).ref = ref;
(globalThis as any).onMounted = onMounted;
(globalThis as any).AuthenticationStore = () => ({
  isAuthenticated: true,
  ensureAuthenticated: vi.fn().mockResolvedValue(true),
});

const DEVICES = [
  {
    id: "sub-1",
    endpointOrigin: "https://push.example",
    userAgent: "agent/1.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    endpointHash: "0123456789abcdef",
  },
  {
    id: "sub-2",
    endpointOrigin: "https://other.example",
    userAgent: "",
    createdAt: "",
    endpointHash: "fedcba9876543210",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.confirm = vi.fn(() => true);
});

describe("devices page", () => {
  it("renders the subscribed devices with origin and browser details", async () => {
    vi.mocked(PushService.listSubscriptions).mockResolvedValueOnce(DEVICES);

    const wrapper = mount(DevicesPage);
    await flushPromises();

    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("https://push.example");
    expect(rows[0].text()).toContain("agent/1.0");
    expect(rows[1].text()).toContain("https://other.example");
    expect(rows[1].text()).toContain("Unknown");
  });

  it("shows the empty state when no devices are subscribed", async () => {
    const wrapper = mount(DevicesPage);
    await flushPromises();

    expect(wrapper.find("#devices-list").exists()).toBe(false);
    expect(wrapper.text()).toContain("No push devices subscribed.");
  });

  it("revokes a device and reloads the list after confirmation", async () => {
    vi.mocked(PushService.listSubscriptions).mockResolvedValue(DEVICES);
    vi.mocked(PushService.revokeSubscription).mockResolvedValue(true);

    const wrapper = mount(DevicesPage);
    await flushPromises();

    await wrapper.findAll("tbody tr button")[0]!.trigger("click");
    await flushPromises();

    expect(window.confirm).toHaveBeenCalled();
    expect(PushService.revokeSubscription).toHaveBeenCalledWith("sub-1");
    expect(PushService.listSubscriptions).toHaveBeenCalledTimes(2);
  });

  it("keeps the list when the revocation fails", async () => {
    vi.mocked(PushService.listSubscriptions).mockResolvedValue(DEVICES);
    vi.mocked(PushService.revokeSubscription).mockResolvedValue(false);

    const wrapper = mount(DevicesPage);
    await flushPromises();

    await wrapper.findAll("tbody tr button")[0]!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Failed to revoke the device.");
    expect(PushService.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("marks and unsubscribes the current browser when revoking its own device", async () => {
    vi.mocked(PushService.listSubscriptions).mockResolvedValue(DEVICES);
    vi.mocked(PushService.revokeSubscription).mockResolvedValue(true);
    vi.mocked(PushService.isSupported).mockResolvedValue(true);
    vi.mocked(PushService.getEndpointHash).mockResolvedValue("0123456789abcdef");
    const getRegistration = vi.fn().mockResolvedValue({
      pushManager: {
        getSubscription: vi
          .fn()
          .mockResolvedValue({ endpoint: "https://push.example/one" }),
      },
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    const wrapper = mount(DevicesPage);
    await flushPromises();

    expect(wrapper.text()).toContain("This device");
    await wrapper.findAll("tbody tr button")[0]!.trigger("click");
    await flushPromises();

    expect(PushService.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
