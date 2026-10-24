import { FastifyRequest } from "fastify";
import { BoundedRateLimiter } from "../RateLimit";

const WINDOW_MS = 60_000;
const limiter = new BoundedRateLimiter({ windowMs: WINDOW_MS, maxBuckets: 10_000 });

type AuthAction = "login" | "registration";

const limits: Record<AuthAction, { ip: number; username: number }> = {
  login: { ip: 30, username: 10 },
  registration: { ip: 5, username: 3 },
};

export function AuthRateLimit(
  request: FastifyRequest,
  username: unknown,
  action: AuthAction,
  now: number = Date.now(),
): boolean {
  const normalizedUsername =
    typeof username === "string" ? username.trim().toLowerCase() : "";
  const actionLimits = limits[action];

  if (
    !limiter.tryConsume(
      `${action}:ip:${request.ip}`,
      actionLimits.ip,
      now,
    )
  ) {
    return false;
  }
  if (
    normalizedUsername &&
    !limiter.tryConsume(
      `${action}:username:${normalizedUsername}`,
      actionLimits.username,
      now,
    )
  ) {
    return false;
  }
  return true;
}
