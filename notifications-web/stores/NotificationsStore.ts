import axios from "axios";
import { acceptHMRUpdate, defineStore } from "pinia";
import Config from "../services/Config";
import { AuthService } from "../services/AuthService";

export const NotificationsStore = defineStore("NotificationsStore", {
  state: () => ({
    notifications: [] as any[],
    total: 0,
    sources: [] as string[],
    sourceUnreadCounts: {} as Record<string, number>,
    sourceFilter: "",
    readFilter: "unread",
    severityFilter: "",
    searchQuery: "",
    loading: false,
    loaded: false,
    unreadCount: 0,
    requestId: 0,
  }),

  actions: {
    async loadNotifications(append = false): Promise<void> {
      if (append && (this.loading || this.notifications.length >= this.total)) {
        return;
      }
      const requestId = ++this.requestId;
      this.loading = true;
      try {
        const headers = await AuthService.getAuthHeader();
        const offset = append ? this.notifications.length : 0;
        let url = `${(await Config.get()).SERVER_URL}/notifications?limit=50&offset=${offset}&read=${this.readFilter}`;
        if (this.sourceFilter) {
          url += `&source=${encodeURIComponent(this.sourceFilter)}`;
        }
        if (this.severityFilter) {
          url += `&severity=${encodeURIComponent(this.severityFilter)}`;
        }
        if (this.searchQuery) {
          url += `&q=${encodeURIComponent(this.searchQuery)}`;
        }
        const res = await axios.get(url, headers);
        if (requestId !== this.requestId) return;
        this.notifications = append
          ? [
              ...this.notifications,
              ...res.data.notifications.filter(
                (item: any) =>
                  !this.notifications.some((current: any) => current.id === item.id),
              ),
            ]
          : res.data.notifications;
        this.total = res.data.total;
        this.loaded = true;
        await this.loadUnreadCount();
      } catch (err) {
        if (requestId === this.requestId) {
          console.error("Failed to load notifications", err);
        }
      } finally {
        if (requestId === this.requestId) {
          this.loading = false;
        }
      }
    },

    async loadUnreadCount(): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        const res = await axios.get(
          `${(await Config.get()).SERVER_URL}/notifications?limit=1&read=unread`,
          headers,
        );
        this.unreadCount = res.data.total;
      } catch (err) {
        console.error("Failed to load unread notification count", err);
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
        this.sourceUnreadCounts = res.data.unreadCounts ?? {};
      } catch (err) {
        console.error("Failed to load notification sources", err);
      }
    },

    async getNotification(id: string): Promise<any | null> {
      try {
        const headers = await AuthService.getAuthHeader();
        const res = await axios.get(
          `${(await Config.get()).SERVER_URL}/notifications/${id}`,
          headers,
        );
        return res.data;
      } catch (err) {
        console.error("Failed to load notification", err);
        return null;
      }
    },

    async ensureNotificationVisible(id: string): Promise<any | null> {
      const existing = this.notifications.find((item) => item.id === id);
      if (existing) {
        return existing;
      }
      const notification = await this.getNotification(id);
      if (!notification) {
        return null;
      }
      this.notifications.unshift(notification);
      this.total += 1;
      return notification;
    },

    async setSourceFilter(source: string): Promise<void> {
      this.sourceFilter = source;
      await this.loadNotifications();
    },

    async setReadFilter(read: string): Promise<void> {
      this.readFilter = read;
      await this.loadNotifications();
    },

    async setSeverityFilter(severity: string): Promise<void> {
      this.severityFilter = severity;
      await this.loadNotifications();
    },

    async setSearchQuery(query: string): Promise<void> {
      this.searchQuery = query.trim();
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
        const notification = this.notifications.find((item) => item.id === id);
        if (notification && notification.read !== read) {
          this.unreadCount += read ? -1 : 1;
          notification.read = read;
        }
      } catch (err) {
        console.error("Failed to update notification read state", err);
      }
    },

    async markAllRead(): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        let url = `${(await Config.get()).SERVER_URL}/notifications/read-all?read=${this.readFilter}`;
        if (this.sourceFilter) {
          url += `&source=${encodeURIComponent(this.sourceFilter)}`;
        }
        if (this.severityFilter) {
          url += `&severity=${encodeURIComponent(this.severityFilter)}`;
        }
        if (this.searchQuery) {
          url += `&q=${encodeURIComponent(this.searchQuery)}`;
        }
        const res = await axios.put(url, {}, headers);
        this.notifications.forEach((notification) => {
          notification.read = true;
        });
        if (this.readFilter === "unread") {
          this.unreadCount = Math.max(0, this.unreadCount - res.data.updated);
        } else {
          await this.loadUnreadCount();
        }
      } catch (err) {
        console.error("Failed to mark notifications as read", err);
      }
    },

    async deleteNotification(id: string): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        await axios.delete(
          `${(await Config.get()).SERVER_URL}/notifications/${id}`,
          headers,
        );
        await this.loadNotifications();
      } catch (err) {
        console.error("Failed to delete notification", err);
      }
    },

    async deleteAll(): Promise<void> {
      try {
        const headers = await AuthService.getAuthHeader();
        let url = `${(await Config.get()).SERVER_URL}/notifications?read=${this.readFilter}`;
        if (this.sourceFilter) {
          url += `&source=${encodeURIComponent(this.sourceFilter)}`;
        }
        if (this.severityFilter) {
          url += `&severity=${encodeURIComponent(this.severityFilter)}`;
        }
        if (this.searchQuery) {
          url += `&q=${encodeURIComponent(this.searchQuery)}`;
        }
        await axios.delete(url, headers);
        await this.loadNotifications();
      } catch (err) {
        console.error("Failed to delete notifications", err);
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NotificationsStore, import.meta.hot));
}
