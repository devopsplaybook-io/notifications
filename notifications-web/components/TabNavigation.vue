<template>
  <div class="tab-navigation">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.id"
      :to="{ path: tab.to, query: route.query }"
      :class="['tab', { active: isActive(tab) }]"
    >
      <span class="tab-label">{{ tab.label }}</span>
    </NuxtLink>
  </div>
</template>

<script setup>
import { useRoute } from "vue-router";

defineProps({
  tabs: {
    type: Array,
    required: true,
  },
});

const route = useRoute();

function normalizePath(path) {
  return String(path || "").replace(/\/+$/, "") || "/";
}

function isActive(tab) {
  const currentPath = normalizePath(route.path);
  const tabPath = normalizePath(tab.to);
  if (tab.exact) {
    return currentPath === tabPath;
  }
  return currentPath === tabPath || currentPath.startsWith(tabPath + "/");
}
</script>

<style scoped>
.tab-navigation {
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-base);
  border-bottom: 1px solid var(--color-border-light);
  /* The tabs pull themselves 1px over the border (margin-bottom: -1px plus a
     2px border-bottom), so the content box must absorb that 1px: without this
     padding it is a vertical overflow, and because overflow-x: auto makes
     overflow-y default to auto, browsers with classic (non-overlay) scrollbars
     render a scrollbar next to the tab bar. */
  padding: 0 0 1px;
  overflow-x: auto;
  max-width: 100%;
  min-width: 0;
  scrollbar-width: thin;
}
.tab {
  background: none;
  border: none;
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  font-size: var(--font-body);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  min-width: 0;
  text-decoration: none;
  color: inherit;
  font-weight: bold;
  opacity: 0.3;
  transition:
    color 0.2s,
    border-color 0.2s;
}
/* Ellipsis must live on the label: text-overflow has no effect on flex containers */
.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.tab:hover {
  opacity: 0.6;
}
/* On phones, tighten spacing so full labels fit without truncation; the bar
   falls back to horizontal scrolling below that. */
@media (max-width: 480px) {
  .tab-navigation {
    gap: 0;
  }
  .tab {
    padding: var(--space-sm) var(--space-sm);
    font-size: var(--font-base);
  }
}
.tab.active {
  opacity: 1;
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}
:root[data-theme="light"] .tab.active {
  color: var(--color-primary-dark);
  border-bottom-color: var(--color-primary-dark);
}
</style>
