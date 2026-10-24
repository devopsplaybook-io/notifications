<template>
  <div class="alert-messages">
    <div
      v-for="alert in alertsStore.messages"
      :key="alert.id"
      class="alert-message"
      role="alert"
    >
      <i class="bi bi-exclamation-triangle-fill"></i>
      <span class="alert-text">{{ alert.message }}</span>
      <button
        type="button"
        class="alert-dismiss"
        aria-label="Dismiss error"
        @click="alertsStore.dismiss(alert.id)"
      >
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertsStore } from "~/stores/AlertsStore";

const alertsStore = AlertsStore();
</script>

<style scoped>
.alert-messages {
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.alert-message {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-error-border);
  color: var(--color-text);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  box-shadow: 0 2px 8px var(--color-shadow-md);
}

.alert-message > i {
  color: var(--color-danger);
}

.alert-text {
  flex: 1;
}

.alert-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  width: auto;
  border: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.alert-dismiss:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
