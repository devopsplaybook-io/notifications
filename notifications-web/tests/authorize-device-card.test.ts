// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import AuthorizeDeviceCard from "@devopsplaybook.io/common-web/components/AuthorizeDeviceCard.vue";

const SERVER_TIME = "2026-01-01T00:00:00.000Z";
const EXPIRES_AT = "2026-01-01T00:05:00.000Z";

const LoginCodeInputStub = defineComponent({
  name: "LoginCodeInput",
  props: {
    modelValue: { type: String, default: "" },
    label: { type: String, default: "" },
    length: { type: Number, default: 8 },
    error: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue", "submit"],
  template:
    '<input class="login-code-input-stub" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

function capabilities(available: boolean) {
  return {
    enabled: true,
    available,
    codeLength: 8,
    rotationSeconds: 30,
    graceSeconds: 60,
    ttlSeconds: 300,
    pollIntervalMs: 2000,
    approveRequiresPassword: false,
    serverTime: SERVER_TIME,
  };
}

function baseService(available: boolean) {
  return {
    capabilities: vi.fn().mockResolvedValue(capabilities(available)),
    preview: vi.fn().mockResolvedValue({
      deviceLabel: "Chrome on Linux",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      createdAt: SERVER_TIME,
      expiresAt: EXPIRES_AT,
      userName: "admin",
      serverTime: SERVER_TIME,
    }),
    approve: vi.fn().mockResolvedValue({
      approved: true,
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
    }),
    create: vi.fn(),
    poll: vi.fn(),
    cancel: vi.fn(),
  };
}

function mountCard(service: ReturnType<typeof baseService>) {
  return mount(AuthorizeDeviceCard, {
    props: { service: service as any },
    global: { stubs: { LoginCodeInput: LoginCodeInputStub } },
  });
}

describe("AuthorizeDeviceCard", () => {
  it("disables the form and shows the unavailable message when capabilities are off", async () => {
    const service = baseService(false);
    const wrapper = mountCard(service);
    await flushPromises();

    expect(wrapper.text()).toContain("Login with a code is unavailable");
    const preview = wrapper
      .findAll("button")
      .find((button) => button.text() === "Continue")!;
    expect(preview.attributes("disabled")).toBeDefined();
    expect(service.preview).not.toHaveBeenCalled();
  });

  it("previews the device, then approves the code", async () => {
    const service = baseService(true);
    const wrapper = mountCard(service);
    await flushPromises();

    await wrapper.find(".login-code-input-stub").setValue("BCDFGHJK");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(service.preview).toHaveBeenCalledWith(
      "BCDFGHJK",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain("admin");
    expect(wrapper.text()).toContain("Chrome on Linux");

    const approve = wrapper
      .findAll("button")
      .find((button) => button.text() === "Approve sign-in")!;
    await approve.trigger("click");
    await flushPromises();

    expect(service.approve).toHaveBeenCalledWith(
      { code: "BCDFGHJK", password: undefined },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.text()).toContain("Sign-in approved");
  });
});
