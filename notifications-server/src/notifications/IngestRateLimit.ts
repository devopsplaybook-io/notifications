import { createHash } from "crypto";
import { Config } from "../Config";
import { BoundedRateLimiter } from "../RateLimit";

export const NOTIFICATION_INGEST_RATE_LIMIT_DEFAULT = 120;

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

let config: Config | undefined;
let limiter = new BoundedRateLimiter({
  windowMs: WINDOW_MS,
  maxBuckets: MAX_BUCKETS,
});

export function NotificationIngestRateLimitInit(configIn: Config): void {
  config = configIn;
  limiter = new BoundedRateLimiter({
    windowMs: WINDOW_MS,
    maxBuckets: MAX_BUCKETS,
  });
}

/**
 * Coarse per-API-token limit for notification creation. Only a hash of the
 * token is kept as the bucket key, never the raw token.
 */
export function NotificationIngestRateLimit(
  token: string,
  now: number = Date.now(),
): boolean {
  const configured = Number(config?.NOTIFICATION_INGEST_RATE_LIMIT);
  const limit =
    Number.isFinite(configured) && configured > 0
      ? configured
      : NOTIFICATION_INGEST_RATE_LIMIT_DEFAULT;
  const key = `ingest:${createHash("sha256").update(token).digest("hex")}`;
  return limiter.tryConsume(key, limit, now);
}
