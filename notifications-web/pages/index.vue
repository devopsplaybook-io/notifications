<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="empty-state">
      <i class="bi bi-bell-slash-fill"></i>
      <p>Please login to view notifications.</p>
    </div>

    <div v-else-if="notificationsStore.loading" class="loading-indicator"></div>

    <div v-else>
      <div class="page-actions">
        <div class="filters">
          <select
            :value="notificationsStore.readFilter"
            class="read-filter"
            aria-label="Filter by read state"
            @change="onReadFilterChange"
          >
            <option value="unread">Unread</option>
            <option value="read">Read</option>
            <option value="all">All</option>
          </select>
          <select
            :value="notificationsStore.sourceFilter"
            class="source-filter"
            aria-label="Filter by source"
            @change="onSourceFilterChange"
          >
            <option value="">All sources</option>
            <option
              v-for="source in notificationsStore.sources"
              :key="source"
              :value="source"
            >
              {{ source }}
            </option>
          </select>
        </div>
        <button
          class="outline secondary"
          :disabled="notificationsStore.notifications.length === 0"
          @click="markAllRead"
        >
          <i class="bi bi-check2-all"></i> Mark all as read
        </button>
      </div>

      <div
        v-if="notificationsStore.notifications.length === 0"
        class="empty-state"
      >
        <i class="bi bi-bell-fill"></i>
        <p>{{ emptyMessage }}</p>
      </div>

      <div v-else id="notifications-list">
        <article
          v-for="n in notificationsStore.notifications"
          :key="n.id"
          :class="['notification-card', { unread: !n.read }]"
        >
          <header>
            <div class="notification-header">
              <h3>
                <i :class="severityIcon(n.severity)"></i>
                {{ n.title }}
              </h3>
              <div class="notification-actions">
                <span :class="'severity-badge severity-' + n.severity">{{
                  n.severity
                }}</span>
                <button
                  class="read-btn"
                  :title="n.read ? 'Mark as unread' : 'Mark as read'"
                  @click="toggleRead(n)"
                >
                  <i :class="n.read ? 'bi bi-envelope' : 'bi bi-envelope-open'"></i>
                </button>
                <button
                  class="delete-btn"
                  title="Delete"
                  @click="deleteNotification(n.id)"
                >
                  <i class="bi bi-x-lg"></i>
                </button>
              </div>
            </div>
            <div class="notification-meta">
              <span
                ><i class="bi bi-clock"></i> {{ formatDate(n.createdAt) }}</span
              >
              <span><i class="bi bi-app-indicator"></i> {{ n.source }}</span>
            </div>
          </header>
          <section v-if="n.body" class="notification-body">
            <div
              :class="[
                'notification-content',
                { expanded: n._expanded, truncatable: isLongContent(n.body) },
              ]"
              v-html="renderMarkdown(n.body)"
            ></div>
            <button
              v-if="isLongContent(n.body)"
              class="expand-btn outline secondary"
              @click="toggleExpand(n)"
            >
              <i
                :class="n._expanded ? 'bi bi-chevron-up' : 'bi bi-chevron-down'"
              ></i>
              {{ n._expanded ? "Show less" : "Show more" }}
            </button>
          </section>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { marked } from "marked";
import DOMPurify from "dompurify";

const notificationsStore = NotificationsStore();
const authenticationStore = AuthenticationStore();

const emptyMessage = computed(() => {
  if (notificationsStore.readFilter === "unread") {
    return "No unread notifications.";
  }
  if (notificationsStore.readFilter === "read") {
    return "No read notifications.";
  }
  return notificationsStore.sourceFilter
    ? "No notifications for this source."
    : "No notifications yet.";
});

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

function severityIcon(severity) {
  switch (severity) {
    case "error":
      return "bi bi-exclamation-triangle-fill";
    case "warning":
      return "bi bi-exclamation-circle-fill";
    case "success":
      return "bi bi-check-circle-fill";
    default:
      return "bi bi-info-circle-fill";
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function renderMarkdown(text) {
  if (!text) return "";
  const html = marked.parse(text);
  return DOMPurify.sanitize(html);
}

function isLongContent(text) {
  if (!text) return false;
  return text.length > 500 || text.split("\n").length > 10;
}

async function deleteNotification(id) {
  await notificationsStore.deleteNotification(id);
}

function onSourceFilterChange(event) {
  notificationsStore.setSourceFilter(event.target.value);
}

function onReadFilterChange(event) {
  notificationsStore.setReadFilter(event.target.value);
}

function toggleRead(n) {
  notificationsStore.markRead(n.id, !n.read);
}

function toggleExpand(n) {
  n._expanded = !n._expanded;
  if (n._expanded && !n.read) {
    notificationsStore.markRead(n.id, true);
  }
}

function markAllRead() {
  notificationsStore.markAllRead();
}

onMounted(async () => {
  if (await authenticationStore.ensureAuthenticated()) {
    notificationsStore.loadSources();
    notificationsStore.loadNotifications();
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

.page-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-sm) var(--space-xs);
}

.page-actions button {
  font-size: var(--font-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0;
}

.filters {
  display: flex;
  gap: var(--space-sm);
}

.page-actions select {
  font-size: var(--font-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0;
  width: auto;
  min-width: 9rem;
}

#notifications-list {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-sm);
}

.notification-card {
  margin: 0;
  background: var(--color-bg-subtle);
}

.notification-card.unread {
  background: var(--color-primary-light);
  border-left: 3px solid var(--color-primary);
}

.notification-card.unread h3 {
  font-weight: 600;
}

.notification-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-sm);
}

.notification-header h3 {
  margin: 0;
  font-size: var(--font-lg);
  flex: 1;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: var(--space-xs);
  margin: 0;
  font-size: var(--font-sm);
  line-height: 1;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}

.delete-btn:hover {
  color: var(--color-danger);
  background: var(--color-danger-bg, rgba(220, 53, 69, 0.1));
}

.read-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: var(--space-xs);
  margin: 0;
  font-size: var(--font-sm);
  line-height: 1;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}

.read-btn:hover {
  color: var(--color-primary);
  background: var(--color-primary-light);
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

.notification-body {
  margin-top: var(--space-sm);
}

.notification-content {
  position: relative;
}

.notification-content.truncatable {
  max-height: 200px;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.notification-content.truncatable.expanded {
  max-height: none;
}

.notification-content.truncatable:not(.expanded)::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(
    transparent,
    var(--pico-card-background-color, var(--pico-background-color))
  );
  pointer-events: none;
}

/* Markdown content styling */
.notification-content :deep(h1),
.notification-content :deep(h2),
.notification-content :deep(h3) {
  margin-top: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.notification-content :deep(p) {
  margin-bottom: var(--space-xs);
}

.notification-content :deep(ul),
.notification-content :deep(ol) {
  padding-left: var(--space-lg);
  margin-bottom: var(--space-xs);
}

.notification-content :deep(code) {
  background: var(--pico-code-background-color, rgba(0, 0, 0, 0.05));
  padding: 0.1em 0.3em;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
}

.notification-content :deep(pre) {
  background: var(--pico-code-background-color, rgba(0, 0, 0, 0.05));
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: 0.85em;
}

.notification-content :deep(pre code) {
  background: none;
  padding: 0;
}

.expand-btn {
  width: 100%;
  margin-top: var(--space-xs);
  font-size: var(--font-sm);
  padding: var(--space-xs);
}
</style>
