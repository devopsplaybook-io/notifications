<script setup>
import { PushService } from "~/services/PushService";
import { formatTabTitle } from "~/services/TabTitle";

const notificationsStore = NotificationsStore();
const authenticationStore = AuthenticationStore();

// Reactive tab title: the open tab itself signals new items, e.g.
// "(3) Notifications". The base title comes from nuxt.config.ts.
useHead({
  title: () =>
    formatTabTitle(
      notificationsStore.unreadCount,
      authenticationStore.isAuthenticated,
    ),
});

useAppHeight();

onMounted(async () => {
  // Re-register push only when the user previously enabled it; never
  // auto-subscribes and never triggers the browser permission prompt.
  if (await authenticationStore.ensureAuthenticated()) {
    await PushService.syncIfEnabled();
  }
});
</script>

<template>
  <div id="page-layout">
    <header>
      <Navigation />
    </header>
    <main>
      <NuxtPage />
    </main>
    <AlertMessages id="page-alert-messages" />
  </div>
</template>

<style>
#page-layout {
  height: var(--app-height, 100dvh);
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden !important;
  width: 100vw;
}

header,
main {
  padding: var(--space-sm);
  overflow: hidden;
}
</style>
