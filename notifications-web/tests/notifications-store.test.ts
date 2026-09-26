import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/Config", () => ({
  default: { get: vi.fn().mockResolvedValue({ SERVER_URL: "/api" }) },
}));
vi.mock("../services/AuthService", () => ({
  AuthService: {
    getAuthHeader: vi.fn().mockResolvedValue({
      headers: { Authorization: "Bearer test-session" },
    }),
  },
}));
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import axios from "axios";
import { NotificationsStore } from "../stores/NotificationsStore";

const mockedAxios = vi.mocked(axios);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for notification requests");
}

describe("notification store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loads additional pages and updates totals and the unread badge", async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { notifications: [{ id: "1" }], total: 51 },
      } as any)
      .mockResolvedValueOnce({ data: { total: 51 } } as any)
      .mockResolvedValueOnce({
        data: { notifications: [{ id: "2" }], total: 51 },
      } as any)
      .mockResolvedValueOnce({ data: { total: 50 } } as any);

    const store = NotificationsStore();
    await store.loadNotifications();
    await store.loadNotifications(true);

    expect(mockedAxios.get.mock.calls[0]![0]).toContain("limit=50&offset=0");
    expect(mockedAxios.get.mock.calls[2]![0]).toContain("limit=50&offset=1");
    expect(store.notifications.map((item) => item.id)).toEqual(["1", "2"]);
    expect(store.total).toBe(51);
    expect(store.unreadCount).toBe(50);
  });

  it("keeps the newest source/read filters when older list requests finish later", async () => {
    const requests: Array<{
      url: string;
      response: ReturnType<typeof deferred<{ data: any }>>;
    }> = [];
    mockedAxios.get.mockImplementation((url) => {
      const response = deferred<{ data: any }>();
      requests.push({ url: String(url), response });
      return response.promise as any;
    });

    const store = NotificationsStore();
    const initialLoad = store.loadNotifications();
    await waitFor(() => requests.length === 1);
    const sourceChange = store.setSourceFilter("build");
    const readChange = store.setReadFilter("all");
    await waitFor(() => requests.length === 3);

    expect(requests[2]!.url).toContain("read=all");
    expect(requests[2]!.url).toContain("source=build");
    requests[2]!.response.resolve({
      data: { notifications: [{ id: "new-filter" }], total: 1 },
    });
    await waitFor(() => requests.length === 4);
    requests[3]!.response.resolve({ data: { total: 1 } });
    await readChange;
    requests[1]!.response.resolve({
      data: { notifications: [{ id: "stale-filter" }], total: 1 },
    });
    requests[0]!.response.resolve({
      data: { notifications: [{ id: "initial" }], total: 1 },
    });
    await Promise.all([initialLoad, sourceChange]);

    expect(store.notifications.map((item) => item.id)).toEqual(["new-filter"]);
    expect(store.sourceFilter).toBe("build");
    expect(store.readFilter).toBe("all");
  });

  it("deletes all notifications and clears the unread badge", async () => {
    mockedAxios.delete.mockResolvedValueOnce({} as any);
    const store = NotificationsStore();
    store.notifications = [{ id: "1" }];
    store.total = 1;
    store.unreadCount = 1;
    await store.deleteAll();
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      "/api/notifications",
      expect.anything(),
    );
    expect(store.notifications).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.unreadCount).toBe(0);
  });
});
