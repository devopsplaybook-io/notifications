import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "../services/AuthService";

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

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwtWith(payload: Record<string, unknown>): string {
  return [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url(payload),
    "signature",
  ].join(".");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", createLocalStorage());
});

describe("auth token robustness", () => {
  it("returns a stored, unexpired token", async () => {
    const token = jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("auth_token", token);

    await expect(AuthService.getToken()).resolves.toBe(token);
    await expect(AuthService.isAuthenticated()).resolves.toBe(true);
  });

  it("drops an expired token", async () => {
    localStorage.setItem(
      "auth_token",
      jwtWith({ exp: Math.floor(Date.now() / 1000) - 10 }),
    );

    await expect(AuthService.getToken()).resolves.toBeNull();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("drops a token without an expiry claim", async () => {
    localStorage.setItem("auth_token", jwtWith({ userId: "user-1" }));

    await expect(AuthService.getToken()).resolves.toBeNull();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("drops a malformed token instead of throwing", async () => {
    localStorage.setItem("auth_token", "not-a-jwt");

    await expect(AuthService.getToken()).resolves.toBeNull();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });

  it("returns null and empty headers when nothing is stored", async () => {
    await expect(AuthService.getToken()).resolves.toBeNull();
    await expect(AuthService.getAuthHeader()).resolves.toEqual({});
  });

  it("returns a bearer header for a valid token", async () => {
    const token = jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 });
    await AuthService.saveToken(token);

    await expect(AuthService.getAuthHeader()).resolves.toEqual({
      headers: { Authorization: `Bearer ${token}` },
    });
    await AuthService.removeToken();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });
});
