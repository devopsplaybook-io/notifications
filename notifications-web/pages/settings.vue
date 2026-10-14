<template>
  <div id="settings-page">
    <TabNavigation :tabs="SettingsTabs" />
    <div class="settings-page-content">
      <NuxtPage />
    </div>
  </div>
</template>

<script setup>
import { SettingsTabs } from "~~/services/SettingsTabs";
</script>

<style scoped>
/* Full-height shell: the tab bar stays pinned while the active settings page
   scrolls in the row below. The content row must be `minmax(0, 1fr)`, not
   plain `1fr`: a `1fr` row has an implicit min-content minimum, so a page
   taller than the viewport would expand the grid and crush the tab bar row
   down to its border, hiding the tabs. */
#settings-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
}

.settings-page-content {
  min-height: 0;
  overflow-y: auto;
}
</style>
