<template>
  <div></div>
</template>

<script setup>
// Account management moved under Settings; keep old bookmarks working.
definePageMeta({
  middleware: [
    () => navigateTo("/settings/profile", { replace: true }),
  ],
});
</script>
