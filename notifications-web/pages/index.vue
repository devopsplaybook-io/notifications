<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="login-surface">
      <div v-if="!serverInitialized" class="empty-state">
        <i class="bi bi-person-plus-fill"></i>
        <p>
          No admin user exists yet.
          <NuxtLink to="/settings/profile">Create it in Settings → Profile</NuxtLink>.
        </p>
      </div>
      <template v-else>
        <div class="empty-state">
          <i class="bi bi-bell-fill"></i>
          <p>Sign in to view your notifications.</p>
        </div>
        <article class="login-card">
          <LoginForm @authenticated="initAuthenticatedView" />
        </article>
      </template>
    </div>

    <Loading
      v-else-if="notificationsStore.loading && !notificationsStore.loaded"
      class="notifications-loading"
    />

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
              {{ source
              }}{{
                notificationsStore.sourceUnreadCounts[source]
                  ? ` (${notificationsStore.sourceUnreadCounts[source]})`
                  : ""
              }}
            </option>
          </select>
          <input
            type="search"
            class="search-filter"
            aria-label="Search notifications"
            placeholder="Search title or body…"
            :value="notificationsStore.searchQuery"
            @input="onSearchInput"
          />
          <select
            :value="notificationsStore.severityFilter"
            class="severity-filter"
            aria-label="Filter by severity"
            @change="onSeverityFilterChange"
          >
            <option value="">All severities</option>
            <option value="info">info</option>
            <option value="success">success</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
          </select>
        </div>
        <button
          class="outline secondary"
          :disabled="notificationsStore.notifications.length === 0"
          @click="markAllRead"
        >
          <i class="bi bi-check2-all"></i> Mark all as read
        </button>
        <button class="outline secondary" @click="refreshNotifications">
          <i class="bi bi-arrow-clockwise"></i> Refresh
        </button>
        <button
          v-if="pushSupported"
          class="outline secondary"
          :disabled="pushBusy"
          @click="togglePush"
        >
          <i :class="pushSubscribed ? 'bi bi-bell-slash' : 'bi bi-bell'"></i>
          {{ pushSubscribed ? "Disable push" : "Enable push" }}
        </button>
        <button
          class="outline contrast"
          :disabled="notificationsStore.total === 0"
          @click="deleteAll"
        >
          <i class="bi bi-trash"></i> Delete all
        </button>
      </div>
      <p v-if="pushHint" class="push-hint">{{ pushHint }}</p>
      <p v-if="notificationsStore.loaded" class="result-count">
        Showing {{ notificationsStore.notifications.length }} of
        {{ notificationsStore.total }} notifications
        <span v-if="notificationsStore.unreadCount > 0">
          · {{ notificationsStore.unreadCount }} unread</span
        >
      </p>

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
          :id="`notification-${n.id}`"
          :class="[
            'notification-card',
            {
              unread: !n.read,
              read: n.read,
              highlighted: n.id === highlightId,
            },
          ]"
        >
          <header>
            <div class="notification-header">
              <h3>
                <i :class="severityIcon(n.severity)"></i>
                {{ n.title }}
              </h3>
              <div class="notification-actions">
                <a
                  v-if="notificationUrl(n)"
                  class="open-btn"
                  :href="notificationUrl(n)"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open linked resource"
                  aria-label="Open linked resource"
                >
                  <i class="bi bi-box-arrow-up-right"></i>
                </a>
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
                  class="read-btn"
                  title="Delete notification"
                  aria-label="Delete notification"
                  @click="deleteNotification(n.id)"
                >
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
            <div class="notification-meta">
              <span :title="formatAbsoluteTime(n.createdAt)"
                ><i class="bi bi-clock"></i>
                {{ formatRelativeTime(n.createdAt) }}</span
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
              v-html="renderMarkdown(n)"
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
          <section v-if="notificationData(n)" class="notification-data">
            <dl>
              <div
                v-for="[key, value] in notificationData(n)"
                :key="key"
                class="notification-data-row"
              >
                <dt>{{ key }}</dt>
                <dd>
                  <a
                    v-if="isHttpUrl(value)"
                    :href="value"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ value }}</a
                  >
                  <span v-else>{{ value }}</span>
                </dd>
              </div>
            </dl>
          </section>
        </article>
      </div>
      <div
        v-if="notificationsStore.notifications.length < notificationsStore.total"
        class="load-more"
      >
        <button
          class="outline secondary"
          :disabled="notificationsStore.loading"
          @click="notificationsStore.loadNotifications(true)"
        >
          {{ notificationsStore.loading ? "Loading..." : "Load more" }}
        </button>
      </div>
      <p v-if="pushError" class="push-error">{{ pushError }}</p>
    </div>
  </div>
</template>

<script setup>
import { PushService } from "~/services/PushService";
import { RenderCache } from "~/services/RenderCache";
import { UserService } from "~/services/UserService";
import {
  extractNotificationUrl,
  formatAbsoluteTime,
  formatRelativeTime,
  isHttpUrl,
  parseNotificationData,
} from "~/services/NotificationFormat";

const notificationsStore = NotificationsStore();
const authenticationStore = AuthenticationStore();
const route = useRoute();
const router = useRouter();
const highlightId = ref("");
const pushSupported = ref(false);
const pushSubscribed = ref(false);
const pushPermission = ref("denied");
const pushBusy = ref(false);
const pushError = ref("");
const searchDebounceTimer = ref(null);
const serverInitialized = ref(true);
let unreadPollTimer = null;

const pushHint = computed(() => {
  if (!pushSupported.value || pushSubscribed.value) {
    return "";
  }
  if (pushPermission.value === "default") {
    return 'Click "Enable push" and allow browser notifications to receive alerts.';
  }
  if (pushPermission.value === "denied") {
    return "Browser notifications are blocked for this site.";
  }
  return "";
});

const emptyMessage = computed(() => {
  if (notificationsStore.readFilter === "unread") {
    return "No unread notifications.";
  }
  if (notificationsStore.readFilter === "read") {
    return "No read notifications.";
  }
  if (notificationsStore.sourceFilter) {
    return "No notifications for this source.";
  }
  if (notificationsStore.searchQuery) {
    return "No notifications match your search.";
  }
  if (notificationsStore.severityFilter) {
    return "No notifications with this severity.";
  }
  return "No notifications yet.";
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

function renderMarkdown(notification) {
  return RenderCache.renderMarkdown(notification.id, notification.body);
}

function notificationData(n) {
  return parseNotificationData(n.data);
}

function notificationUrl(n) {
  return extractNotificationUrl(n.data);
}

async function handleDeepLink() {
  const id = route.query.notification;
  if (typeof id !== "string" || id === "") {
    return;
  }
  const notification = await notificationsStore.ensureNotificationVisible(id);
  if (notification) {
    highlightId.value = id;
    notification._expanded = true;
    if (!notification.read) {
      await notificationsStore.markRead(id, true);
    }
    await nextTick();
    document
      .getElementById(`notification-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  await router.replace({ query: { ...route.query, notification: undefined } });
}

function isLongContent(text) {
  if (!text) return false;
  return text.length > 500 || text.split("\n").length > 10;
}

function onSourceFilterChange(event) {
  notificationsStore.setSourceFilter(event.target.value);
}

function onReadFilterChange(event) {
  notificationsStore.setReadFilter(event.target.value);
}

function onSeverityFilterChange(event) {
  notificationsStore.setSeverityFilter(event.target.value);
}

function onSearchInput(event) {
  clearTimeout(searchDebounceTimer.value);
  searchDebounceTimer.value = setTimeout(() => {
    notificationsStore.setSearchQuery(event.target.value);
  }, 300);
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

async function refreshNotifications() {
  await Promise.all([
    notificationsStore.loadSources(),
    notificationsStore.loadNotifications(),
  ]);
}

async function refreshOnWake() {
  if (authenticationStore.isAuthenticated && notificationsStore.loaded) {
    await refreshNotifications();
  }
}

async function onPollTick() {
  if (
    !authenticationStore.isAuthenticated ||
    document.visibilityState !== "visible"
  ) {
    return;
  }
  const unreadBefore = notificationsStore.unreadCount;
  await notificationsStore.loadUnreadCount();
  if (notificationsStore.loaded && notificationsStore.unreadCount !== unreadBefore) {
    await refreshNotifications();
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") {
    refreshOnWake();
  }
}

async function deleteNotification(id) {
  if (window.confirm("Delete this notification?")) {
    await notificationsStore.deleteNotification(id);
  }
}

async function deleteAll() {
  if (window.confirm("Delete all notifications matching the current filters? This cannot be undone.")) {
    await notificationsStore.deleteAll();
  }
}

async function togglePush() {
  pushBusy.value = true;
  pushError.value = "";
  try {
    const success = pushSubscribed.value
      ? await PushService.unsubscribe()
      : await PushService.subscribe();
    if (!success) {
      pushError.value = "Unable to update push notification settings.";
      return;
    }
    pushSubscribed.value = await PushService.isSubscribed();
    pushPermission.value = await PushService.getPermission();
  } finally {
    pushBusy.value = false;
  }
}

async function initAuthenticatedView() {
  if (unreadPollTimer) {
    clearInterval(unreadPollTimer);
    unreadPollTimer = null;
  }
  await refreshNotifications();
  await handleDeepLink();
  unreadPollTimer = setInterval(onPollTick, 60000);
  pushSupported.value = await PushService.isSupported();
  pushSubscribed.value = await PushService.isSubscribed();
  pushPermission.value = await PushService.getPermission();
}

onMounted(async () => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", refreshOnWake);
  // When the first admin account does not exist yet, point the visitor to the
  // bootstrap form in Settings instead of a login that can never succeed.
  try {
    serverInitialized.value = await UserService.isInitialized();
  } catch (err) {
    console.error("Failed to check user initialization", err);
  }
  if (await authenticationStore.ensureAuthenticated()) {
    await initAuthenticatedView();
  }
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("focus", refreshOnWake);
  if (unreadPollTimer) {
    clearInterval(unreadPollTimer);
    unreadPollTimer = null;
  }
  clearTimeout(searchDebounceTimer.value);
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

.login-surface {
  max-width: 420px;
  margin: 0 auto;
  padding: var(--space-xl) var(--space-sm);
}

.login-card {
  margin: 0;
}

.page-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-sm) var(--space-xs);
}

.result-count {
  padding: 0 var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--font-sm);
}

.load-more {
  display: flex;
  justify-content: center;
  padding: var(--space-sm);
}

.push-error {
  color: var(--color-danger);
  padding: 0 var(--space-sm);
}

.push-hint {
  color: var(--color-text-muted);
  font-size: var(--font-sm);
  padding: 0 var(--space-sm) var(--space-xs);
}

.page-actions button {
  font-size: var(--font-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0;
  min-width: 0;
  white-space: normal;
}

.filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-column: 1 / -1;
  gap: var(--space-sm);
  min-width: 0;
}

.page-actions select {
  font-size: var(--font-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.page-actions input[type="search"] {
  font-size: var(--font-sm);
  padding: var(--space-xs) var(--space-sm);
  margin: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.page-actions button {
  width: 100%;
}

#notifications-list {
  display: grid;
  gap: var(--space-xl);
  padding: var(--space-sm);
}

.notification-card {
  margin: 0;
  border-left: 3px solid transparent;
}

.notification-card.unread {
  border-left-color: var(--color-primary);
}

.notification-card.highlighted {
  border-left-color: var(--color-primary);
  outline: 2px solid var(--color-primary);
  background: var(--color-primary-light);
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
  overflow-wrap: anywhere;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.open-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  padding: var(--space-xs);
  font-size: var(--font-sm);
  line-height: 1;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
}

.open-btn:hover {
  color: var(--color-primary);
  background: var(--color-primary-light);
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
  overflow-wrap: anywhere;
}

.notification-meta i {
  margin-right: var(--space-xs);
}

.notification-body {
  margin-top: var(--space-sm);
}

.notification-content {
  position: relative;
  overflow-wrap: anywhere;
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

.notification-data {
  margin-top: var(--space-sm);
  border-top: 1px solid var(--pico-muted-border-color);
  padding-top: var(--space-xs);
  font-size: var(--font-sm);
}

.notification-data dl {
  margin: 0;
  display: grid;
  gap: var(--space-xs);
}

.notification-data-row {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, 1fr);
  gap: var(--space-sm);
}

.notification-data dt {
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}

.notification-data dd {
  margin: 0;
  overflow-wrap: anywhere;
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
