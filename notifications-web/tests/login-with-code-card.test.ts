// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import LoginWithCodeCard from "@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue";

const SERVER_TIME = "2026-01-01T00:00:00.000Z";
const CODE_EXPIRES_AT = "2026-01-01T00:00:30.000Z";
const EXPIRES_AT = "2026-01-01T00:05:00.000Z";

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

function fakeService(available: boolean) {
  return {
    capabilities: vi.fn().mockResolvedValue(capabilities(available)),
    create: vi.fn().mockResolvedValue({
      requestToken: "request-token",
      code: "BCDFGHJK",
      codeExpiresAt: CODE_EXPIRES_AT,
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
    }),
    poll: vi.fn().mockResolvedValue({
      status: "pending",
      codeExpiresAt: CODE_EXPIRES_AT,
      expiresAt: EXPIRES_AT,
      serverTime: SERVER_TIME,
    }),
    preview: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn().mockResolvedValue({ status: "cancelled", serverTime: SERVER_TIME }),
  };
}

describe("LoginWithCodeCard", () => {
  it("shows the unavailable message and creates no code when the server is unavailable", async () => {
    const service = fakeService(false);
    const wrapper = mount(LoginWithCodeCard, {
      props: { service: service as any, autoStart: true },
    });
    await flushPromises();

    expect(service.create).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Login with a code is unavailable");
  });

  it("renders the grouped code and waits for approval when available", async () => {
    const service = fakeService(true);
    const wrapper = mount(LoginWithCodeCard, {
      props: { service: service as any, autoStart: true },
    });
    await flushPromises();

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".login-with-code-value").text()).toBe("BCDF-GHJK");
    expect(wrapper.text()).toContain("Waiting for approval");
  });
});
