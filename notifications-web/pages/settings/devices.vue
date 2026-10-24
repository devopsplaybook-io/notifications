<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="empty-state">
      <i class="bi bi-phone-fill"></i>
      <p>Please login to manage push devices.</p>
    </div>

    <div v-else id="devices-page">
      <h3><i class="bi bi-phone-fill"></i> Push Devices</h3>
      <p>
        Browsers subscribed to push notifications for your account. Revoke a
        device, for example a lost browser, to stop its push deliveries.
      </p>

      <p v-if="loading" class="devices-loading">Loading devices…</p>

      <div v-else-if="devices.length === 0 && !loadFailed" class="empty-state">
        <i class="bi bi-bell-slash"></i>
        <p>No push devices subscribed.</p>
      </div>

      <div v-else id="devices-list">
        <figure>
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Browser</th>
                <th>Subscribed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="device in devices" :key="device.id">
                <td>
                  <i class="bi bi-globe2"></i> {{ device.endpointOrigin }}
                  <span
                    v-if="isThisDevice(device)"
                    class="this-device-badge"
                    title="This is the current browser"
                    >This device</span
                  >
                </td>
                <td class="device-agent" :title="device.userAgent">
                  {{ device.userAgent || "Unknown" }}
                </td>
                <td :title="formatAbsoluteTime(device.createdAt)">
                  {{ formatSubscribedDate(device.createdAt) }}
                </td>
                <td class="actions">
                  <button
                    class="outline secondary"
                    :disabled="revokingId === device.id"
                    @click="revoke(device)"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </figure>
      </div>

      <button
        class="outline secondary"
        :disabled="loading"
        @click="loadDevices"
      >
        <i class="bi bi-arrow-clockwise"></i> Refresh
      </button>
    </div>
  </div>
</template>

<script setup>
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "~/services/NotificationFormat";
import { PushService } from "~/services/PushService";
import { AlertsStore } from "~/stores/AlertsStore";

const authenticationStore = AuthenticationStore();
const alertsStore = AlertsStore();
const devices = ref([]);
const loading = ref(false);
const loadFailed = ref(false);
const localHash = ref("");
const revokingId = ref("");

function formatSubscribedDate(createdAt) {
  if (!createdAt) {
    return "—";
  }
  return formatRelativeTime(createdAt);
}

function isThisDevice(device) {
  return (
    Boolean(device.endpointHash) &&
    Boolean(localHash.value) &&
    device.endpointHash === localHash.value
  );
}

async function loadDevices() {
  loadFailed.value = false;
  loading.value = true;
  try {
    const list = await PushService.listSubscriptions();
    if (list === null) {
      // Keep any previously loaded list: a failed refresh is not an empty
      // account.
      loadFailed.value = true;
      alertsStore.showError("Failed to load push devices.");
      return;
    }
    devices.value = list;
  } catch (err) {
    console.error("Failed to load push devices", err);
    loadFailed.value = true;
    alertsStore.showError("Failed to load push devices.");
  } finally {
    loading.value = false;
  }
}

async function loadLocalHash() {
  if (!(await PushService.isSupported())) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      localHash.value = await PushService.getEndpointHash(
        subscription.endpoint,
      );
    }
  } catch (err) {
    localHash.value = "";
  }
}

async function revoke(device) {
  if (!window.confirm(`Revoke push notifications for ${device.endpointOrigin}?`)) {
    return;
  }
  revokingId.value = device.id;
  try {
    if (await PushService.revokeSubscription(device.id)) {
      if (isThisDevice(device)) {
        await PushService.unsubscribe();
      }
      await loadDevices();
    } else {
      alertsStore.showError("Failed to revoke the device.");
    }
  } catch (err) {
    console.error("Failed to revoke the device", err);
    alertsStore.showError("Failed to revoke the device.");
  } finally {
    revokingId.value = "";
  }
}

onMounted(async () => {
  if (await authenticationStore.ensureAuthenticated()) {
    await loadDevices();
    await loadLocalHash();
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

#devices-page {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-xl);
}

.this-device-badge {
  margin-left: var(--space-xs);
  padding: 0 0.4em;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  font-size: var(--font-sm);
}

.device-agent {
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  text-align: right;
}

.devices-loading {
  color: var(--color-text-muted);
}
</style>
