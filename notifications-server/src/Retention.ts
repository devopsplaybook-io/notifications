const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Validate a NOTIFICATION_RETENTION_DAYS value.
 * Returns a non-negative integer, or undefined when the value is unusable
 * (non-numeric, fractional, negative, NaN, infinite).
 */
export function RetentionValidateDays(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * Holds the retention window used by the pruning job.
 *
 * The configuration may be reloaded at runtime (config file watch); an
 * invalid reload is rejected and the previous known-good value is kept so a
 * bad value can neither mass-delete notifications (negative cutoff) nor
 * crash the pruning timer (invalid date).
 */
export class RetentionConfig {
  private currentDays: number;

  constructor(initial: unknown) {
    const validated = RetentionValidateDays(initial);
    if (validated === undefined) {
      throw new Error("NOTIFICATION_RETENTION_DAYS must be a non-negative integer");
    }
    this.currentDays = validated;
  }

  public get days(): number {
    return this.currentDays;
  }

  /** Apply a reloaded value; returns false and keeps the previous value when invalid. */
  public apply(candidate: unknown): boolean {
    const validated = RetentionValidateDays(candidate);
    if (validated === undefined) {
      return false;
    }
    this.currentDays = validated;
    return true;
  }

  /**
   * Cutoff ISO timestamp for the current retention window.
   * Returns undefined when pruning is disabled (0 days) or when the computed
   * date is invalid (NaN or out-of-range) so the timer callback can never
   * throw.
   */
  public cutoff(nowMs: number = Date.now()): string | undefined {
    if (this.currentDays === 0) {
      return undefined;
    }
    const cutoffDate = new Date(nowMs - this.currentDays * DAY_MS);
    if (Number.isNaN(cutoffDate.getTime())) {
      return undefined;
    }
    return cutoffDate.toISOString();
  }
}
