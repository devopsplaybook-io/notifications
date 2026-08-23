import Config from "./Config";

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

  public static async requestPermission(): Promise<NotificationPermission> {
    if (!(await PushService.isSupported())) {
      return "denied";
    }
    if (Notification.permission === "granted") {
      return "granted";
    }
    return Notification.requestPermission();
  }

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

      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        // Get VAPID public key from server
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

        // Subscribe
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: PushService.urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      // Send subscription to server
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
          Authorization: token,
        },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!response.ok) {
        console.error("Failed to save push subscription");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Push subscription failed:", error);
      return false;
    }
  }

  private static urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}
