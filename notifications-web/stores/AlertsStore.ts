import { acceptHMRUpdate, defineStore } from "pinia";

export interface AlertMessage {
  id: number;
  message: string;
}

export const AlertsStore = defineStore("AlertsStore", {
  state: () => ({
    messages: [] as AlertMessage[],
    nextId: 1,
  }),

  actions: {
    showError(message: string) {
      const text = (message ?? "").trim();
      if (!text || this.messages.some((entry) => entry.message === text)) {
        return;
      }
      this.messages.push({ id: this.nextId++, message: text });
    },

    dismiss(id: number) {
      this.messages = this.messages.filter((entry) => entry.id !== id);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(AlertsStore, import.meta.hot));
}
