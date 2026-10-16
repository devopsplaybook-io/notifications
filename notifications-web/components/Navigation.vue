<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" class="brand-link"
          ><img src="/icon.svg" alt="Notifications" class="nav-logo" />
          <strong>Notifications</strong></NuxtLink
        >
      </li>
    </ul>
    <ul class="menu-links">
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/"
          class="notification-link"
          :class="activeRoute == '' ? 'active' : 'inactive'"
          ><span class="notification-icon"
            ><i class="bi bi-bell-fill"></i>
            <span
              v-if="notificationsStore.unreadCount > 0"
              class="unread-badge"
              :aria-label="`${notificationsStore.unreadCount} unread notifications`"
              >{{ notificationsStore.unreadCount }}</span
            ></span
          >
          <span class="nav-label">Notifications</span>
        </NuxtLink>
      </li>
      <li>
        <NuxtLink
          to="/settings"
          :class="activeRoute == 'settings' ? 'active' : 'inactive'"
          ><i class="bi bi-gear-fill"></i>
          <span class="nav-label">Settings</span></NuxtLink
        >
      </li>
    </ul>
  </nav>
</template>

<script lang="ts">
import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { PreferencesService } from "~/services/PreferencesService";

export default {
  watch: {
    $route(to, from) {
      this.routeUpdated(to);
    },
  },
  data() {
    return {
      activeRoute: "",
      unreadPollTimer: null as ReturnType<typeof setInterval> | null,
      authenticationStore: AuthenticationStore(),
      notificationsStore: NotificationsStore(),
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    if (await AuthenticationStore().ensureAuthenticated()) {
      NotificationsStore().loadUnreadCount();
      // Keep the unread badge fresh on every page without manual refresh
      this.unreadPollTimer = setInterval(() => {
        if (document.visibilityState === "visible") {
          NotificationsStore().loadUnreadCount();
        }
      }, 60000);
      setTimeout(async () => {
        axios
          .post(
            `${(await Config.get()).SERVER_URL}/users/session`,
            {},
            await AuthService.getAuthHeader(),
          )
          .then((res) => {
            AuthService.saveToken(res.data.token);
          });
      }, 10000);
    }
    PreferencesService.applyTheme();
  },
  methods: {
    routeUpdated(newRoute: { fullPath: string }) {
      this.activeRoute = newRoute.fullPath.split("/")[1] ?? "";
    },
  },
  beforeUnmount() {
    if (this.unreadPollTimer) {
      clearInterval(this.unreadPollTimer);
      this.unreadPollTimer = null;
    }
  },
};
</script>

<style scoped>
.menu-links li {
  padding-top: var(--space-xs);
  padding-bottom: var(--space-xs);
}
.menu-links li {
  padding-right: var(--space-base);
}
.menu-links .inactive {
  opacity: 0.3;
}
.menu-links .active {
  color: var(--color-primary);
}
.menu-links {
  font-weight: bold;
}

.notification-icon {
  position: relative;
  display: inline-flex;
  margin-right: var(--space-sm);
}

.notification-icon i {
  margin-right: 0;
}

.nav-logo {
  height: 1.4em;
  vertical-align: middle;
  margin-right: var(--space-sm);
}

.menu-links i {
  margin-right: var(--space-sm);
}

.unread-badge {
  position: absolute;
  top: -0.45rem;
  right: -0.7rem;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  margin: 0;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-size: 0.7rem;
}

@media (max-width: 1000px) {
  .nav-label {
    display: none;
  }
}

:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: var(--color-primary-dark);
}
</style>
