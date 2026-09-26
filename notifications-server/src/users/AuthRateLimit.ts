import { FastifyRequest } from "fastify";

const WINDOW_MS = 60_000;
const buckets = new Map<string, number[]>();

type AuthAction = "login" | "registration";

const limits: Record<AuthAction, { ip: number; username: number }> = {
  login: { ip: 30, username: 10 },
  registration: { ip: 5, username: 3 },
};

function recordAttempt(key: string, limit: number, now: number): boolean {
  const attempts = (buckets.get(key) || []).filter(
    (timestamp) => now - timestamp < WINDOW_MS,
  );
  if (attempts.length >= limit) {
    buckets.set(key, attempts);
    return false;
  }
  attempts.push(now);
  buckets.set(key, attempts);
  return true;
}

export function AuthRateLimit(
  request: FastifyRequest,
  username: unknown,
  action: AuthAction,
): boolean {
  const now = Date.now();
  const normalizedUsername =
    typeof username === "string" ? username.trim().toLowerCase() : "";
  const actionLimits = limits[action];

  if (!recordAttempt(`${action}:ip:${request.ip}`, actionLimits.ip, now)) {
    return false;
  }
  if (
    normalizedUsername &&
    !recordAttempt(
      `${action}:username:${normalizedUsername}`,
      actionLimits.username,
      now,
    )
  ) {
    return false;
  }

  if (buckets.size > 10_000) {
    for (const [key, attempts] of buckets) {
      if (attempts.every((timestamp) => now - timestamp >= WINDOW_MS)) {
        buckets.delete(key);
      }
    }
  }
  return true;
}
