import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";

export const NotificationsStore = defineStore("NotificationsStore", {
  state: () => ({
    notifications: [] as any[],
    total: 0,
    loading: false,
    loaded: false,
  }),

  actions: {
    async loadNotifications(): Promise<void> {
      if (this.loading) return;
      this.loading = true;
      try {
        const headers = await AuthService.getAuthHeader();
        const res = await axios.get(
          `${(await Config.get()).SERVER_URL}/notifications?limit=50&offset=0`,
          headers,
        );
        this.notifications = res.data.notifications;
        this.total = res.data.total;
        this.loaded = true;
      } catch (err) {
        console.error("Failed to load notifications", err);
      } finally {
        this.loading = false;
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(NotificationsStore, import.meta.hot));
}
