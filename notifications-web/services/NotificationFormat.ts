export type NotificationDataEntry = [key: string, value: string];

/**
 * Parse a notification `data` payload (JSON string or object) into a plain
 * object. Returns null for anything that is not a non-empty plain object so
 * callers can hide the data section.
 */
function parseDataObject(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return Object.keys(record).length > 0 ? record : null;
}

/** Accept only string values that parse as http(s) URLs. */
export function isHttpUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") {
    return false;
  }
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Format a date string as an absolute local date and time. */
export function formatAbsoluteTime(dateStr: string): string {
  if (!dateStr) {
    return "";
  }
  return new Date(dateStr).toLocaleString();
}

/** Format a date string as a compact relative time ("5m ago"). */
export function formatRelativeTime(dateStr: string): string {
  if (!dateStr) {
    return "";
  }
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (Number.isNaN(seconds)) {
    return "";
  }
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatAbsoluteTime(dateStr);
}

/**
 * Turn a notification `data` payload into ordered key/value string pairs for
 * rendering, or null when there is nothing to show.
 */
export function parseNotificationData(
  raw: unknown,
): NotificationDataEntry[] | null {
  const data = parseDataObject(raw);
  if (!data) {
    return null;
  }
  return Object.entries(data).map(([key, value]) => [
    key,
    typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value),
  ]);
}

/**
 * Extract an action URL from a notification `data` payload: `data.url` when
 * present and valid, otherwise the first http(s) URL value in insertion
 * order. Only http(s) URLs are returned so the value is safe to bind to href.
 */
export function extractNotificationUrl(raw: unknown): string | undefined {
  const data = parseDataObject(raw);
  if (!data) {
    return undefined;
  }
  if (isHttpUrl(data.url)) {
    return data.url;
  }
  return Object.values(data).find(isHttpUrl);
}
