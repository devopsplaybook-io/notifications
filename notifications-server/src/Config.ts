import { ConfigBase } from "@devopsplaybook.io/common-utils";

export class Config extends ConfigBase {
  public JWT_KEY = "";
  public VAPID_PUBLIC_KEY = "";
  public VAPID_PRIVATE_KEY = "";
  public VAPID_SUBJECT = "";

  constructor() {
    super("notifications-server");
    this.addConfigField({ field: "JWT_KEY", sensitive: true });
    this.addConfigField({ field: "VAPID_PUBLIC_KEY" });
    this.addConfigField({ field: "VAPID_PRIVATE_KEY", sensitive: true });
    this.addConfigField({ field: "VAPID_SUBJECT" });
  }
}
