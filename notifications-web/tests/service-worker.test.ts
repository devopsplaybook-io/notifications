import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function createWorkerContext(clients: any[] = []) {
  const handlers: Record<string, (event: any) => void> = {};
  const shown: any[] = [];
  const opened: string[] = [];
  const context = {
    URL,
    self: {
      location: { origin: "https://notifications.example" },
      registration: {
        showNotification: async (title: string, options: any) =>
          shown.push({ title, options }),
      },
      addEventListener: (name: string, handler: (event: any) => void) => {
        handlers[name] = handler;
      },
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url: string) => opened.push(url),
    },
  };
  runInNewContext(workerSource, context);
  return { handlers, shown, opened };
}

describe("service worker", () => {
  it("preserves notification id and serialized data for display and clicks", async () => {
    const { handlers, shown } = createWorkerContext();
    let completion: Promise<void>;
    handlers.push!({
      data: {
        json: () => ({
          id: "id-1",
          title: "Build",
          data: '{"run":4}',
          url: "/?id=id-1",
        }),
      },
      waitUntil: (promise: Promise<void>) => {
        completion = promise;
      },
    });
    await completion!;
    expect(shown[0].options.tag).toBe("id-1");
    expect(shown[0].options.data.url).toBe("/?id=id-1");
    expect(shown[0].options.data.notificationData).toBe('{"run":4}');
  });

  it("matches absolute client URLs by pathname and navigates to the click URL", async () => {
    let navigated: string | undefined;
    let focused = false;
    const client = {
      url: "https://notifications.example/",
      navigate: async (url: string) => {
        navigated = url;
      },
      focus: async () => {
        focused = true;
      },
    };
    const { handlers, opened } = createWorkerContext([client]);
    let completion: Promise<void>;
    handlers.notificationclick!({
      notification: {
        data: { url: "/?id=id-1" },
        close: () => {},
      },
      waitUntil: (promise: Promise<void>) => {
        completion = promise;
      },
    });
    await completion!;
    expect(navigated).toBe("https://notifications.example/?id=id-1");
    expect(focused).toBe(true);
    expect(opened).toEqual([]);
  });
});
