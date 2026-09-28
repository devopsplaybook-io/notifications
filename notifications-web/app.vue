<script setup>
import { PushService } from "~/services/PushService";

const notificationsStore = NotificationsStore();
const authenticationStore = AuthenticationStore();

useAppHeight();

onMounted(async () => {
  // Subscribe to push notifications after authentication
  if (await authenticationStore.ensureAuthenticated()) {
    await PushService.subscribe();
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
