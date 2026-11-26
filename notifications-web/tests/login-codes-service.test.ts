import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../services/AuthService", () => ({
  AuthService: {
    getAuthHeader: vi.fn().mockResolvedValue({
      headers: { Authorization: "Bearer session-token" },
    }),
    saveToken: vi.fn().mockResolvedValue(undefined),
  },
}));

import axios from "axios";
import { AuthService } from "../services/AuthService";
import { createNotificationsLoginCodeService } from "../utils/loginCodes";

const mockedGet = vi.mocked(axios.get);
const mockedPost = vi.mocked(axios.post);

const CAPABILITIES = {
  enabled: true,
  available: true,
  codeLength: 8,
  rotationSeconds: 30,
  graceSeconds: 60,
  ttlSeconds: 300,
  pollIntervalMs: 2000,
  approveRequiresPassword: false,
  serverTime: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifications login-code service", () => {
  it("probes the app-prefixed capabilities endpoint without auth", async () => {
    mockedGet.mockResolvedValueOnce({ data: CAPABILITIES });
    const service = createNotificationsLoginCodeService({ isAuthenticated: false });

    const capabilities = await service.capabilities();

    expect(capabilities.enabled).toBe(true);
    expect(mockedGet).toHaveBeenCalledWith(
      "/api/users/login-codes/capabilities",
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it("approves with the session header and the submitted code", async () => {
    mockedPost.mockResolvedValueOnce({
      data: { approved: true, expiresAt: "2026-01-01T00:05:00.000Z", serverTime: "2026-01-01T00:00:00.000Z" },
    });
    const service = createNotificationsLoginCodeService({ isAuthenticated: true });

    await service.approve({ code: "BCDFGHJK" });

    expect(mockedPost).toHaveBeenCalledWith(
      "/api/users/login-codes/approve",
      { code: "BCDFGHJK" },
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token" },
      }),
    );
  });

  it("persists an approved session through AuthService and the store", async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        status: "approved",
        token: "renewed-session",
        user: { id: "user-1", name: "admin" },
        expiresAt: "2026-01-01T00:05:00.000Z",
        serverTime: "2026-01-01T00:00:00.000Z",
      },
    });
    const store = { isAuthenticated: false };
    const service = createNotificationsLoginCodeService(store);

    const result = await service.poll("request-token");

    expect(result.status).toBe("approved");
    expect(mockedPost).toHaveBeenCalledWith(
      "/api/users/login-codes/poll",
      { requestToken: "request-token" },
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(AuthService.saveToken).toHaveBeenCalledWith("renewed-session");
    expect(store.isAuthenticated).toBe(true);
  });
});
