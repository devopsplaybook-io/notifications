import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthService } from "../services/AuthService";
import {
  SESSION_RENEWAL_MAX_DELAY_MS,
  SESSION_RENEWAL_MIN_DELAY_MS,
  SessionRenewalDelayMs,
  SessionRenewalIsDue,
  SessionRenewalRefresh,
} from "../services/SessionRenewal";

const NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = NOW_MS / 1000;
const DAY_SECONDS = 24 * 60 * 60;

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", createLocalStorage());
});

describe("SessionRenewalIsDue", () => {
  it("is not due while more than 20% of the lifetime remains", () => {
    const claims = { iat: NOW_SECONDS, exp: NOW_SECONDS + 30 * DAY_SECONDS };
    expect(SessionRenewalIsDue(claims, NOW_MS)).toBe(false);
  });

  it("is due once 20% or less of the lifetime remains", () => {
    const issuedAt = NOW_SECONDS - 24 * DAY_SECONDS;
    const claims = { iat: issuedAt, exp: issuedAt + 30 * DAY_SECONDS };
    // 6 days left of a 30-day token: exactly 20%.
    expect(SessionRenewalIsDue(claims, NOW_MS)).toBe(true);
  });

  it("ignores claims without a complete lifetime window", () => {
    expect(SessionRenewalIsDue({ exp: NOW_SECONDS + 10 }, NOW_MS)).toBe(false);
    expect(SessionRenewalIsDue({}, NOW_MS)).toBe(false);
  });
});

describe("SessionRenewalDelayMs", () => {
  it("waits until the 20% threshold of the lifetime", () => {
    const claims = { iat: NOW_SECONDS, exp: NOW_SECONDS + 10 * 60 * 60 };
    expect(SessionRenewalDelayMs(claims, NOW_MS)).toBe(8 * 60 * 60 * 1_000);
  });

  it("renews immediately when the threshold is already reached", () => {
    const claims = { iat: NOW_SECONDS - 29 * DAY_SECONDS, exp: NOW_SECONDS + DAY_SECONDS };
    expect(SessionRenewalDelayMs(claims, NOW_MS)).toBe(
      SESSION_RENEWAL_MIN_DELAY_MS,
    );
  });

  it("caps the wait at one day", () => {
    const claims = {
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 365 * DAY_SECONDS,
    };
    expect(SessionRenewalDelayMs(claims, NOW_MS)).toBe(
      SESSION_RENEWAL_MAX_DELAY_MS,
    );
  });

  it("uses the maximum delay when the lifetime is unknown", () => {
    expect(SessionRenewalDelayMs({}, NOW_MS)).toBe(
      SESSION_RENEWAL_MAX_DELAY_MS,
    );
  });
});

describe("SessionRenewalRefresh", () => {
  it("exchanges the stored token through the session endpoint", async () => {
    const oldToken = jwtWith({
      exp: Math.floor(Date.now() / 1000) + 3_600,
      iat: Math.floor(Date.now() / 1000),
    });
    const newToken = jwtWith({
      exp: Math.floor(Date.now() / 1000) + 2_592_000,
      iat: Math.floor(Date.now() / 1000),
    });
    await AuthService.saveToken(oldToken);
    const post = vi
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { token: newToken } });

    await expect(SessionRenewalRefresh()).resolves.toBe(newToken);

    expect(post).toHaveBeenCalledWith(
      "/api/users/session",
      {},
      { headers: { Authorization: `Bearer ${oldToken}` } },
    );
    await expect(AuthService.getToken()).resolves.toBe(newToken);
  });

  it("does nothing without a stored session", async () => {
    const post = vi.spyOn(axios, "post");
    await expect(SessionRenewalRefresh()).resolves.toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
