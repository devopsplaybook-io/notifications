import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/Config", () => ({
  default: { get: vi.fn().mockResolvedValue({ SERVER_URL: "/api" }) },
}));

import { PushService } from "../services/PushService";
import { PreferencesService } from "../services/PreferencesService";

const TOKEN = "session-token";

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

function createSubscription() {
  const json = {
    endpoint: "https://push.example/endpoint",
    keys: { p256dh: "public-key", auth: "auth-key" },
  };
  return {
    endpoint: json.endpoint,
    toJSON: () => json,
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

let subscription: ReturnType<typeof createSubscription>;
let getSubscription: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
let register: ReturnType<typeof vi.fn>;
let getRegistration: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();

  vi.stubGlobal("localStorage", createLocalStorage());
  localStorage.setItem("auth_token", TOKEN);

  subscription = createSubscription();
  getSubscription = vi.fn().mockResolvedValue(subscription);
  subscribe = vi.fn().mockResolvedValue(subscription);
  register = vi.fn().mockResolvedValue({
    pushManager: { getSubscription, subscribe },
  });
  getRegistration = vi.fn().mockResolvedValue({
    pushManager: { getSubscription },
  });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register,
      ready: Promise.resolve(),
      getRegistration,
    },
  });
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("PushManager", class PushManagerStub {});
  requestPermission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("Notification", {
    permission: "granted",
    requestPermission,
  });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("push service preference lifecycle", () => {
  it("reports unsupported browsers as not subscribable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(PushService.isSupported()).resolves.toBe(false);
    await expect(PushService.subscribe()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores the push preference only after a successful server-side save", async () => {
    getSubscription.mockResolvedValueOnce(null);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: "BEl62iUYgU" }),
      })
      .mockResolvedValueOnce({ ok: true });

    await expect(PushService.subscribe()).resolves.toBe(true);

    expect(register).toHaveBeenCalledWith("/sw.js");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/push/publickey");
    const saveCall = fetchMock.mock.calls[1]!;
    expect(saveCall[0]).toBe("/api/push/subscribe");
    expect(saveCall[1].method).toBe("POST");
    expect(saveCall[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(saveCall[1].body).subscription.endpoint).toBe(
      subscription.endpoint,
    );
    expect(PreferencesService.isPushEnabled()).toBe(true);
  });

  it("leaves the preference off when the server rejects the subscription", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    await expect(PushService.subscribe()).resolves.toBe(false);

    expect(PreferencesService.isPushEnabled()).toBe(false);
  });

  it("does not touch the browser or server when push was never enabled", async () => {
    PreferencesService.setPushEnabled(false);

    await PushService.syncIfEnabled();

    expect(getRegistration).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("re-registers an existing browser subscription without prompting", async () => {
    PreferencesService.setPushEnabled(true);
    fetchMock.mockResolvedValueOnce({ ok: true });

    await PushService.syncIfEnabled();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saveCall = fetchMock.mock.calls[0]!;
    expect(saveCall[0]).toBe("/api/push/subscribe");
    expect(saveCall[1].method).toBe("POST");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(PreferencesService.isPushEnabled()).toBe(true);
  });

  it("stays quiet when the browser has no subscription to re-register", async () => {
    PreferencesService.setPushEnabled(true);
    getSubscription.mockResolvedValue(null);

    await PushService.syncIfEnabled();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears server and browser state and disables the preference on unsubscribe", async () => {
    PreferencesService.setPushEnabled(true);
    fetchMock.mockResolvedValueOnce({ ok: true });

    await expect(PushService.unsubscribe()).resolves.toBe(true);

    const deleteCall = fetchMock.mock.calls[0]!;
    expect(deleteCall[0]).toBe("/api/push/subscribe");
    expect(deleteCall[1].method).toBe("DELETE");
    expect(JSON.parse(deleteCall[1].body).endpoint).toBe(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(PreferencesService.isPushEnabled()).toBe(false);
  });

  it("keeps push enabled when the server-side delete fails", async () => {
    PreferencesService.setPushEnabled(true);
    fetchMock.mockResolvedValueOnce({ ok: false });

    await expect(PushService.unsubscribe()).resolves.toBe(false);

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(PreferencesService.isPushEnabled()).toBe(true);
  });
});
