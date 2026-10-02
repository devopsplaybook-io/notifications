const {
  RetentionConfig,
  RetentionValidateDays,
} = require("../dist/Retention");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("retention configuration", () => {
  test("validates values as non-negative integers", () => {
    expect(RetentionValidateDays(90)).toBe(90);
    expect(RetentionValidateDays(0)).toBe(0);
    expect(RetentionValidateDays(-1)).toBeUndefined();
    expect(RetentionValidateDays(1.5)).toBeUndefined();
    expect(RetentionValidateDays(NaN)).toBeUndefined();
    expect(RetentionValidateDays(Infinity)).toBeUndefined();
    expect(RetentionValidateDays("90")).toBeUndefined();
    expect(RetentionValidateDays(undefined)).toBeUndefined();
  });

  test("throws on invalid startup values (boot fails fast)", () => {
    expect(() => new RetentionConfig(-1)).toThrow(/non-negative integer/);
    expect(() => new RetentionConfig("abc")).toThrow(/non-negative integer/);
    expect(() => new RetentionConfig(NaN)).toThrow(/non-negative integer/);
    expect(new RetentionConfig(30).days).toBe(30);
  });

  test("rejects an invalid reloaded value and keeps the previous one", () => {
    const retention = new RetentionConfig(90);
    expect(retention.apply("not-a-number")).toBe(false);
    expect(retention.days).toBe(90);
    expect(retention.apply(-7)).toBe(false);
    expect(retention.days).toBe(90);
    expect(retention.apply(45)).toBe(true);
    expect(retention.days).toBe(45);
    expect(retention.apply(0)).toBe(true);
    expect(retention.days).toBe(0);
  });

  test("computes the cutoff and never throws on invalid inputs", () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    const retention = new RetentionConfig(30);
    expect(retention.cutoff(now)).toBe(
      new Date(now - 30 * DAY_MS).toISOString(),
    );
    retention.apply(0);
    expect(retention.cutoff(now)).toBeUndefined();

    const huge = new RetentionConfig(Number.MAX_SAFE_INTEGER);
    expect(huge.cutoff(now)).toBeUndefined();
    const normal = new RetentionConfig(30);
    expect(normal.cutoff(NaN)).toBeUndefined();
  });
});
