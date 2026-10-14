<template>
  <div></div>
</template>

<script setup>
definePageMeta({
  middleware: [
    () => navigateTo("/settings/profile", { replace: true }),
  ],
});
</script>
