import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as path from "path";
import { readJsonSync } from "fs-extra";

/**
 * Addresses/CIDRs of the reverse proxies allowed to set X-Forwarded-For. The
 * default covers loopback (local Traefik dev proxy) and the k3s pod network
 * where the production cloudflared tunnel pods live. Trusting every private
 * range would let any private peer spoof the client IP.
 */
export const DEFAULT_TRUSTED_PROXIES = "127.0.0.1,::1,10.42.0.0/16";

/** Web Push service hosts accepted as subscription endpoints. A leading "*."
 * matches subdomains only; extend it for self-hosted push services. */
export const DEFAULT_PUSH_ALLOWED_HOSTS =
  "fcm.googleapis.com,android.googleapis.com,push.services.mozilla.com,*.push.services.mozilla.com,*.notify.windows.com,*.wns.windows.com,web.push.apple.com,*.push.apple.com";

export function ParseTrustedProxies(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export class Config extends ConfigBase {
  public JWT_KEY = "";
  public VAPID_PUBLIC_KEY = "";
  public VAPID_PRIVATE_KEY = "";
  public VAPID_SUBJECT = "";
  public NOTIFICATION_RETENTION_DAYS = 90;
  // SMTP configuration for the email notification rules; empty SMTP_HOST
  // disables the email feature (rules CRUD keeps working, evaluation skips)
  public SMTP_HOST = "";
  public SMTP_PORT = 587;
  public SMTP_SECURE = false;
  public SMTP_USER = "";
  public SMTP_PASSWORD = "";
  public SMTP_FROM = "";
  public APP_PUBLIC_URL = "https://notifications.didierhoarau.cloud";
  // Reverse proxy addresses/CIDRs trusted for X-Forwarded-For; read only at
  // startup because Fastify fixes trustProxy at boot.
  public TRUSTED_PROXIES = DEFAULT_TRUSTED_PROXIES;
  public PUSH_ALLOWED_HOSTS = DEFAULT_PUSH_ALLOWED_HOSTS;
  // Per-API-token creation limit for POST /api/notifications, in requests per
  // minute; non-positive or invalid values fall back to 120.
  public NOTIFICATION_INGEST_RATE_LIMIT = 120;
  // Session validity in seconds: 90 days by default (field is inherited from
  // ConfigBase and can be overridden via the JWT_VALIDITY_DURATION env variable)
  public JWT_VALIDITY_DURATION = 90 * 24 * 3600;

  constructor() {
    super("notifications-server");
    this.VERSION = readJsonSync(
      path.resolve(process.cwd(), "package.json"),
    ).version;
    this.addConfigField({ field: "JWT_KEY", sensitive: true });
    this.addConfigField({ field: "VAPID_PUBLIC_KEY" });
    this.addConfigField({ field: "VAPID_PRIVATE_KEY", sensitive: true });
    this.addConfigField({ field: "VAPID_SUBJECT" });
    this.addConfigField({ field: "NOTIFICATION_RETENTION_DAYS" });
    this.addConfigField({ field: "SMTP_HOST" });
    this.addConfigField({ field: "SMTP_PORT" });
    this.addConfigField({ field: "SMTP_SECURE" });
    this.addConfigField({ field: "SMTP_USER" });
    this.addConfigField({ field: "SMTP_PASSWORD", sensitive: true });
    this.addConfigField({ field: "SMTP_FROM" });
    this.addConfigField({ field: "APP_PUBLIC_URL" });
    this.addConfigField({ field: "TRUSTED_PROXIES" });
    this.addConfigField({ field: "PUSH_ALLOWED_HOSTS" });
    this.addConfigField({ field: "NOTIFICATION_INGEST_RATE_LIMIT" });
  }
}
