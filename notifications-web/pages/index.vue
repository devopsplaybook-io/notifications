<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="empty-state">
      <i class="bi bi-bell-slash-fill"></i>
      <p>Please login to view notifications.</p>
    </div>

    <div v-else-if="notificationsStore.loading" class="loading-indicator"></div>

    <div v-else-if="notificationsStore.notifications.length === 0" class="empty-state">
      <i class="bi bi-bell-fill"></i>
      <p>No notifications yet.</p>
    </div>

    <div v-else id="notifications-list">
      <article
        v-for="n in notificationsStore.notifications"
        :key="n.id"
        class="notification-card"
      >
        <header>
          <div class="notification-header">
            <h3>
              <i :class="severityIcon(n.severity)"></i>
              {{ n.title }}
            </h3>
            <span :class="'severity-badge severity-' + n.severity">{{ n.severity }}</span>
          </div>
          <div class="notification-meta">
            <span><i class="bi bi-clock"></i> {{ formatDate(n.createdAt) }}</span>
            <span><i class="bi bi-app-indicator"></i> {{ n.source }}</span>
          </div>
        </header>
        <section v-if="n.body">
          <p>{{ n.body }}</p>
        </section>
      </article>
    </div>
  </div>
</template>

<script setup>
const notificationsStore = NotificationsStore();
const authenticationStore = AuthenticationStore();

function severityIcon(severity) {
  switch (severity) {
    case "error": return "bi bi-exclamation-triangle-fill";
    case "warning": return "bi bi-exclamation-circle-fill";
    case "success": return "bi bi-check-circle-fill";
    default: return "bi bi-info-circle-fill";
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleString();
}

onMounted(async () => {
  if (await authenticationStore.ensureAuthenticated()) {
    notificationsStore.loadNotifications();
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

#notifications-list {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-sm);
}

.notification-card {
  margin: 0;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.notification-header h3 {
  margin: 0;
  font-size: var(--font-lg);
}

.notification-meta {
  display: flex;
  gap: var(--space-base);
  font-size: var(--font-sm);
  color: var(--color-text-muted);
  margin-top: var(--space-xs);
}

.notification-meta i {
  margin-right: var(--space-xs);
}
</style>
