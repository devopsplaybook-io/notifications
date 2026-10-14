<template>
  <div></div>
</template>

<script setup>
// The API-token management moved under Settings; keep old bookmarks working.
definePageMeta({
  middleware: [
    () => navigateTo("/settings/api-keys", { replace: true }),
  ],
});
</script>
