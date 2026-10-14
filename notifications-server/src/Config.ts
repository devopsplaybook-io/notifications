import { ConfigBase } from "@devopsplaybook.io/common-utils";
import * as path from "path";
import { readJsonSync } from "fs-extra";

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
  }
}
