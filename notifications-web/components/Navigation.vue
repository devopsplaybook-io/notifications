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
        <NuxtLink to="/" :class="activeRoute == '' ? 'active' : 'inactive'"
          ><i class="bi bi-bell-fill"></i>
          <span class="nav-label">Notifications</span></NuxtLink
        >
      </li>
      <li v-if="authenticationStore.isAuthenticated">
        <NuxtLink
          to="/tokens"
          :class="activeRoute == 'tokens' ? 'active' : 'inactive'"
          ><i class="bi bi-key-fill"></i>
          <span class="nav-label">API Tokens</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/users"
          :class="activeRoute == 'users' ? 'active' : 'inactive'"
          ><i class="bi bi-person-circle"></i>
          <span class="nav-label">Users</span></NuxtLink
        >
      </li>
      <li>
        <button class="theme-toggle" @click="toggleTheme" title="Toggle theme">
          <i class="bi bi-moon-fill"></i>
        </button>
      </li>
    </ul>
  </nav>
</template>

<script setup>
import { AuthService } from "~~/services/AuthService";
import { PreferencesService } from "~/services/PreferencesService";
const authenticationStore = AuthenticationStore();

function toggleTheme() {
  PreferencesService.toggleTheme();
}
</script>

<script>
import axios from "axios";
import Config from "~~/services/Config.ts";

export default {
  watch: {
    $route(to, from) {
      this.routeUpdated(to);
    },
  },
  data() {
    return {
      activeRoute: "",
    };
  },
  async created() {
    this.routeUpdated(this.$route);
    if (await AuthenticationStore().ensureAuthenticated()) {
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
    routeUpdated(newRoute) {
      this.activeRoute = newRoute.fullPath.split("/")[1];
    },
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

.nav-logo {
  height: 1.4em;
  vertical-align: middle;
  margin-right: var(--space-sm);
}

.menu-links i {
  margin-right: var(--space-sm);
}

.theme-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.2em;
  color: var(--color-text);
  padding: 0;
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
