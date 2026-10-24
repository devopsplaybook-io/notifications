// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
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
import AlertMessages from "../components/AlertMessages.vue";
import EmailsPage from "../pages/settings/emails.vue";

// Nuxt auto-imports these in the app; provide minimal fakes as globals so the
// page under test resolves them the same way it does at runtime.
(globalThis as any).ref = ref;
(globalThis as any).onMounted = onMounted;
(globalThis as any).AuthenticationStore = () => ({
  isAuthenticated: true,
  ensureAuthenticated: vi.fn().mockResolvedValue(true),
});

const mockedGet = vi.mocked(axios.get);
const mockedPost = vi.mocked(axios.post);
const mockedPut = vi.mocked(axios.put);
const mockedDelete = vi.mocked(axios.delete);

const RULES = [
  {
    id: "rule-1",
    source: "ci",
    severity: "error",
    severityMode: "exact",
    recipient: "user@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

const DELIVERIES = [
  {
    id: "delivery-2",
    recipient: "user@example.com",
    notificationId: "n-2",
    notificationTitle: "Build fixed",
    source: "ci",
    severity: "success",
    status: "sent",
    attempts: 2,
    error: "",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: "delivery-1",
    recipient: "other@example.com",
    notificationId: "n-1",
    notificationTitle: "Build failed",
    source: "ci",
    severity: "error",
    status: "failed",
    attempts: 3,
    error: "smtp down",
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  },
];

function mockPageData({ rules = RULES, deliveries = DELIVERIES } = {}) {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/emails/status") {
      return { data: { smtpConfigured: true } };
    }
    if (url === "/api/emails/rules") {
      return { data: { rules } };
    }
    if (url === "/api/notifications/sources") {
      return { data: { sources: ["ci"] } };
    }
    if (url === "/api/emails/deliveries") {
      return { data: { deliveries } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

async function mountPage() {
  const wrapper = mount(EmailsPage);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  window.confirm = vi.fn(() => true);
  mockPageData();
});

describe("emails page", () => {
  it("saves threshold severities with severityMode threshold", async () => {
    const wrapper = await mountPage();

    await wrapper.find("select").setValue("warning:threshold");
    await wrapper.find('input[type="email"]').setValue("user@example.com");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Add")!
      .trigger("click");
    await flushPromises();

    expect(mockedPost).toHaveBeenCalledWith(
      "/api/emails/rules",
      {
        source: "",
        severity: "warning",
        severityMode: "threshold",
        recipient: "user@example.com",
      },
      { headers: { "x-session": "s" } },
    );
  });

  it("keeps plain severities as exact matches", async () => {
    const wrapper = await mountPage();

    await wrapper.find("select").setValue("error");
    await wrapper.find('input[type="email"]').setValue("user@example.com");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Add")!
      .trigger("click");
    await flushPromises();

    expect(mockedPost).toHaveBeenCalledWith(
      "/api/emails/rules",
      {
        source: "",
        severity: "error",
        severityMode: "exact",
        recipient: "user@example.com",
      },
      { headers: { "x-session": "s" } },
    );
  });

  it("prefills threshold rules for editing and updates them", async () => {
    mockPageData({
      rules: [
        {
          id: "rule-9",
          source: "ci",
          severity: "error",
          severityMode: "threshold",
          recipient: "user@example.com",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("error and above");
    await wrapper.find("#email-rules-list .bi-pencil-fill").trigger("click");
    expect((wrapper.find("select").element as HTMLSelectElement).value).toBe(
      "error:threshold",
    );
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Update")!
      .trigger("click");
    await flushPromises();

    expect(mockedPut).toHaveBeenCalledWith(
      "/api/emails/rules/rule-9",
      {
        source: "ci",
        severity: "error",
        severityMode: "threshold",
        recipient: "user@example.com",
      },
      { headers: { "x-session": "s" } },
    );
  });

  it("renders the recent deliveries with status badges and details", async () => {
    const wrapper = await mountPage();

    const rows = wrapper.findAll("#email-deliveries tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("user@example.com");
    expect(rows[0]!.text()).toContain("Build fixed");
    expect(rows[0]!.text()).toContain("✓ sent");
    expect(rows[0]!.text()).toContain("2 attempts");
    expect(rows[1]!.text()).toContain("other@example.com");
    expect(rows[1]!.text()).toContain("✗ failed");
    expect(rows[1]!.text()).toContain("smtp down");
  });

  it("shows the empty state and the load error for deliveries", async () => {
    mockPageData({ deliveries: [] });
    const wrapper = await mountPage();
    expect(wrapper.text()).toContain("No email deliveries yet.");

    mockedGet.mockRejectedValueOnce({
      response: { data: { error: "Access Denied" } },
    });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Refresh")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find("#email-deliveries .form-error").text()).toBe(
      "Access Denied",
    );
  });

  it("renders an alert when saving a rule fails", async () => {
    const wrapper = await mountPage();
    mockedPost.mockRejectedValueOnce({
      response: { data: { error: "Invalid recipient" } },
    });

    await wrapper.find('input[type="email"]').setValue("user@example.com");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Add")!
      .trigger("click");
    await flushPromises();

    const alerts = mount(AlertMessages);
    await flushPromises();
    expect(alerts.find('[role="alert"]').text()).toContain("Invalid recipient");
    expect(
      (wrapper.find('input[type="email"]').element as HTMLInputElement).value,
    ).toBe("user@example.com");
  });

  it("renders an alert when deleting a rule fails", async () => {
    const wrapper = await mountPage();
    mockedDelete.mockRejectedValueOnce(new Error("network down"));

    await wrapper.find("#email-rules-list .bi-trash-fill").trigger("click");
    await flushPromises();

    expect(window.confirm).toHaveBeenCalled();
    const alerts = mount(AlertMessages);
    await flushPromises();
    expect(alerts.find('[role="alert"]').text()).toContain(
      "Failed to delete email rule.",
    );
  });

  it("shows the server error when the test email fails", async () => {
    const wrapper = await mountPage();
    mockedPost.mockRejectedValueOnce({
      response: { data: { error: "SMTP down" } },
    });

    await wrapper.find("#test-email input[type='email']").setValue("user@example.com");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Send Test")!
      .trigger("click");
    await flushPromises();

    expect(wrapper.find("#test-email .form-error").text()).toBe("SMTP down");
  });
});
