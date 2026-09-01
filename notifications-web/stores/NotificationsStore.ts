import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";

export const NotificationsStore = defineStore("NotificationsStore", {
  state: () => ({
    notifications: [] as any[],
    total: 0,
    sources: [] as string[],
    sourceFilter: "",
    readFilter: "unread",
    loading: false,
    loaded: false,
  }),

  actions: {
    async loadNotifications(): Promise<void> {
      if (this.loading) return;
      this.loading = true;
      try {
        const headers = await AuthService.getAuthHeader();
        let url = `${(await Config.get()).SERVER_URL}/notifications?limit=50&offset=0&read=${this.readFilter}`;
        if (this.sourceFilter) {
          url += `&source=${encodeURIComponent(this.sourceFilter)}`;
        }
        const res = await axios.get(url, headers);
        this.notifications = res.data.notifications;
        this.total = res.data.total;
        this.loaded = true;
      } catch (err) {
        console.error("Failed to load notifications", err);
      } finally {
        this.loading = false;
      }
    },

    async loadSources(): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        const res = await axios.get(
          `${(await Config.get()).SERVER_URL}/notifications/sources`,
          headers,
        );
        this.sources = res.data.sources;
      } catch (err) {
        console.error("Failed to load notification sources", err);
      }
    },

    async setSourceFilter(source: string): Promise<void> {
      this.sourceFilter = source;
      await this.loadNotifications();
    },

    async setReadFilter(read: string): Promise<void> {
      this.readFilter = read;
      await this.loadNotifications();
    },

    async markRead(id: string, read: boolean): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        await axios.put(
          `${(await Config.get()).SERVER_URL}/notifications/${id}/read`,
          { read },
          headers,
        );
        const idx = this.notifications.findIndex((n: any) => n.id === id);
        if (idx === -1) return;
        this.notifications[idx].read = read;
        // Drop the item when it no longer matches the active filter
        if (
          (this.readFilter === "unread" && read) ||
          (this.readFilter === "read" && !read)
        ) {
          this.notifications.splice(idx, 1);
          this.total = Math.max(0, this.total - 1);
        }
      } catch (err) {
        console.error("Failed to update notification read state", err);
      }
    },

    async deleteNotification(id: string): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        await axios.delete(
          `${(await Config.get()).SERVER_URL}/notifications/${id}`,
          headers,
        );
        this.notifications = this.notifications.filter((n: any) => n.id !== id);
        this.total--;
        await this.loadSources();
      } catch (err) {
        console.error("Failed to delete notification", err);
      }
    },

    async deleteAllNotifications(): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        await axios.delete(
          `${(await Config.get()).SERVER_URL}/notifications`,
          headers,
        );
        this.notifications = [];
        this.total = 0;
        this.sources = [];
        this.sourceFilter = "";
        this.readFilter = "unread";
      } catch (err) {
        console.error("Failed to delete all notifications", err);
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NotificationsStore, import.meta.hot));
}
