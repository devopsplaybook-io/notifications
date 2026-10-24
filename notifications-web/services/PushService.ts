import Config from "./Config";
import { PreferencesService } from "./PreferencesService";

export interface PushSubscriptionInfo {
  id: string;
  endpointOrigin: string;
  userAgent: string;
  createdAt: string;
  endpointHash: string;
}

export class PushService {
  public static async isSupported(): Promise<boolean> {
    return (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  public static async getPermission(): Promise<NotificationPermission> {
    if (!(await PushService.isSupported())) {
      return "denied";
    }
    return Notification.permission;
  }

  public static async isSubscribed(): Promise<boolean> {
    if (!(await PushService.isSupported())) {
      return false;
    }
    const registration = await navigator.serviceWorker.getRegistration("/");
    return !!(await registration?.pushManager.getSubscription());
  }

  public static async requestPermission(): Promise<NotificationPermission> {
    if (!(await PushService.isSupported())) {
      return "denied";
    }
    if (Notification.permission === "granted") {
      return "granted";
    }
    return Notification.requestPermission();
  }

  /** Subscribe from an explicit user action; requests the browser permission. */
  public static async subscribe(): Promise<boolean> {
    if (!(await PushService.isSupported())) {
      return false;
    }
    const permission = await PushService.requestPermission();
    if (permission !== "granted") {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const config = await Config.get();
        const response = await fetch(`${config.SERVER_URL}/push/publickey`);
        if (!response.ok) {
          console.error("Failed to get VAPID public key");
          return false;
        }
        const { publicKey } = await response.json();
        if (!publicKey) {
          console.error("No VAPID public key available");
          return false;
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: PushService.urlBase64ToUint8Array(
            publicKey,
          ) as BufferSource,
        });
      }

      if (!(await PushService.saveSubscription(subscription))) {
        return false;
      }
      PreferencesService.setPushEnabled(true);
      return true;
    } catch (error) {
      console.error("Push subscription failed:", error);
      return false;
    }
  }

  /**
   * Re-register an existing browser subscription after load when the user has
   * previously enabled push (e.g. the session was recreated). Never prompts
   * and never creates a browser subscription. A subscription revoked remotely
   * (Settings → Devices) is not resurrected: the local preference is cleared
   * instead, so push must be re-enabled manually. When the device list cannot
   * be fetched, the preference is kept and nothing is re-saved, so a later
   * load can re-sync (a transient failure must not disable push).
   */
  public static async syncIfEnabled(): Promise<void> {
    if (!PreferencesService.isPushEnabled()) {
      return;
    }
    if (!(await PushService.isSupported())) {
      return;
    }
    if (Notification.permission !== "granted") {
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        return;
      }
      const endpointHash = await PushService.getEndpointHash(
        subscription.endpoint,
      );
      if (endpointHash) {
        const known = await PushService.listSubscriptions();
        if (known === null) {
          // Cannot prove the device was revoked remotely: keep the preference
          // and do not re-save, so a later load can re-sync. Re-saving here
          // would resurrect a device revoked elsewhere.
          console.warn(
            "Could not verify the push subscription; keeping push enabled",
          );
          return;
        }
        if (!known.some((entry) => entry.endpointHash === endpointHash)) {
          console.info("Push subscription was revoked remotely");
          PreferencesService.setPushEnabled(false);
          return;
        }
      }
      await PushService.saveSubscription(subscription);
    } catch (error) {
      console.error("Push subscription sync failed:", error);
    }
  }

  public static async unsubscribe(): Promise<boolean> {
    if (!(await PushService.isSupported())) {
      return false;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        if (!(await PushService.deleteSubscription(subscription.endpoint))) {
          return false;
        }
        if (!(await subscription.unsubscribe())) {
          return false;
        }
      }
      PreferencesService.setPushEnabled(false);
      return true;
    } catch (error) {
      console.error("Push unsubscription failed:", error);
      return false;
    }
  }

  /** List the push devices of the current session (origin/UA/date only).
   * Returns null when the list cannot be fetched, so callers can tell a failed
   * request from an account without devices. */
  public static async listSubscriptions(): Promise<
    PushSubscriptionInfo[] | null
  > {
    try {
      const config = await Config.get();
      const token = localStorage.getItem("auth_token");
      if (!token) {
        console.error("No auth token for push subscription list");
        return null;
      }
      const response = await fetch(`${config.SERVER_URL}/push/subscriptions`, {
        headers: { Authorization: ["Bearer", token].join(" ") },
      });
      if (!response.ok) {
        console.error("Failed to list push subscriptions");
        return null;
      }
      const body = await response.json();
      if (!Array.isArray(body?.subscriptions)) {
        console.error("Malformed push subscription list");
        return null;
      }
      return body.subscriptions;
    } catch (error) {
      console.error("Failed to list push subscriptions", error);
      return null;
    }
  }

  /** Revoke a push device by id (e.g. a lost browser). */
  public static async revokeSubscription(id: string): Promise<boolean> {
    const config = await Config.get();
    const token = localStorage.getItem("auth_token");
    if (!token) {
      console.error("No auth token for push revocation");
      return false;
    }
    const response = await fetch(
      `${config.SERVER_URL}/push/subscriptions/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: ["Bearer", token].join(" ") },
      },
    );
    if (!response.ok) {
      console.error("Failed to revoke push subscription");
      return false;
    }
    return true;
  }

  /** SHA-256 prefix of the endpoint, matching the server-side hash; "" when
   * Web Crypto is unavailable (e.g. non-secure context). */
  public static async getEndpointHash(endpoint: string): Promise<string> {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      return "";
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(endpoint),
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }

  private static async saveSubscription(
    subscription: PushSubscription,
  ): Promise<boolean> {
    const config = await Config.get();
    const token = localStorage.getItem("auth_token");
    if (!token) {
      console.error("No auth token for push subscription");
      return false;
    }
    const response = await fetch(`${config.SERVER_URL}/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ["Bearer", token].join(" "),
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!response.ok) {
      console.error("Failed to save push subscription");
      return false;
    }
    return true;
  }

  private static async deleteSubscription(endpoint: string): Promise<boolean> {
    const config = await Config.get();
    const token = localStorage.getItem("auth_token");
    if (!token) {
      console.error("No auth token for push unsubscription");
      return false;
    }
    const response = await fetch(`${config.SERVER_URL}/push/subscribe`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: ["Bearer", token].join(" "),
      },
      body: JSON.stringify({ endpoint }),
    });
    if (!response.ok) {
      console.error("Failed to remove push subscription");
      return false;
    }
    return true;
  }

  private static urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}
