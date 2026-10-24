// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onMounted, ref } from "vue";

vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("../services/Config", () => ({
  default: { get: vi.fn().mockResolvedValue({ SERVER_URL: "/api" }) },
}));
vi.mock("../services/AuthService", () => ({
  AuthService: {
    getAuthHeader: vi.fn().mockResolvedValue({ headers: { "x-session": "s" } }),
  },
}));

import axios from "axios";
import ApiKeysPage from "../pages/settings/api-keys.vue";

// Nuxt auto-imports these in the app; provide minimal fakes as globals so the
// page under test resolves them the same way it does at runtime.
(globalThis as any).ref = ref;
(globalThis as any).onMounted = onMounted;
(globalThis as any).AuthenticationStore = () => ({
  isAuthenticated: true,
  ensureAuthenticated: vi.fn().mockResolvedValue(true),
});

const mockedPost = vi.mocked(axios.post);

beforeEach(() => {
  vi.clearAllMocks();
  mockedPost.mockReset();
});

async function mountAndCreateKey() {
  const wrapper = mount(ApiKeysPage);
  await flushPromises();
  await wrapper.find('input[type="text"]').setValue("My App");
  mockedPost.mockResolvedValueOnce({
    data: { id: "token-1", name: "My App", token: "secret-token" },
  });
  await wrapper.findAll("button").find((b) => b.text() === "Create")!.trigger("click");
  await flushPromises();
  return wrapper;
}

describe("api keys page", () => {
  it("caps the key name input at the server-side 200-character limit", async () => {
    const wrapper = mount(ApiKeysPage);
    await flushPromises();
    expect(wrapper.find('input[type="text"]').attributes("maxlength")).toBe(
      "200",
    );
  });

  it("shows a curl example with the instance origin and the created token", async () => {
    const wrapper = await mountAndCreateKey();

    const example = wrapper.find("#curl-example");
    expect(example.exists()).toBe(true);
    expect(example.text()).toContain(`${window.location.origin}/api/notifications`);
    expect(example.text()).toContain(`Bearer ${"secret-token"}`);
    expect(example.text()).toContain("Test notification");
    expect(example.text()).toContain('"source":"My App"');
    // The token input is cleared but the key name is kept for the example
    expect(
      (wrapper.find('input[type="text"]').element as HTMLInputElement).value,
    ).toBe("");
  });

  it("copies the curl example to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = await mountAndCreateKey();

    const copyButton = wrapper
      .findAll("button")
      .find((b) => b.text() === "Copy curl example")!;
    await copyButton.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Bearer secret-token"),
    );
    expect(wrapper.text()).toContain("Copied!");
  });

  it("sends a test notification with the created token and reports success", async () => {
    const wrapper = await mountAndCreateKey();
    mockedPost.mockResolvedValueOnce({ data: { success: true } });

    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send test notification")!
      .trigger("click");
    await flushPromises();

    expect(mockedPost).toHaveBeenLastCalledWith(
      "/api/notifications",
      {
        title: "Test notification",
        body: "Sent from the Notifications API keys page",
        source: "My App",
        severity: "info",
      },
      { headers: { Authorization: "Bearer secret-token" } },
    );
    expect(wrapper.text()).toContain("Test notification sent");
  });

  it("shows the server error when the test notification fails", async () => {
    const wrapper = await mountAndCreateKey();
    mockedPost.mockRejectedValueOnce({
      response: { data: { error: "Invalid token" } },
    });

    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send test notification")!
      .trigger("click");
    await flushPromises();

    expect(wrapper.find(".form-error").text()).toBe("Invalid token");
  });
});
