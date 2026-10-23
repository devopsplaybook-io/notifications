<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="empty-state">
      <i class="bi bi-key-fill"></i>
      <p>Please login to manage API keys.</p>
    </div>

    <div v-else id="api-keys-page">
      <h3><i class="bi bi-key-fill"></i> API Keys</h3>

      <article>
        <header><h4>Create New Key</h4></header>
        <section>
          <label>
            Key Name
            <input type="text" v-model="newTokenName" maxlength="200" placeholder="e.g. My App" />
          </label>
          <button @click="createToken" :disabled="!newTokenName">Create</button>
        </section>
      </article>

      <div v-if="createdToken" class="created-token">
        <article>
          <header><h4>New Key Created</h4></header>
          <section>
            <p>Copy this key now. It won't be shown again:</p>
            <code>{{ createdToken }}</code>
            <div class="curl-example">
              <p>Send a notification with this key from any producer:</p>
              <code id="curl-example">{{ curlExample }}</code>
              <div class="form-actions">
                <button class="secondary" @click="copyCurlExample">
                  {{ curlCopied ? "Copied!" : "Copy curl example" }}
                </button>
                <button @click="sendTestNotification">Send test notification</button>
              </div>
              <p v-if="testResult" :class="testResult.ok ? 'test-success' : 'form-error'">
                {{ testResult.message }}
              </p>
            </div>
          </section>
        </article>
      </div>

      <div v-if="tokens.length === 0 && !createdToken" class="empty-state">
        <i class="bi bi-key"></i>
        <p>No API keys yet.</p>
      </div>

      <div v-else id="api-keys-list">
        <figure v-if="tokens.length > 0">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tokens" :key="t.id">
                <td>{{ t.name }}</td>
                <td>{{ formatDate(t.createdAt) }}</td>
                <td class="actions">
                  <i class="bi bi-trash-fill" @click="deleteToken(t.id)" title="Delete"></i>
                </td>
              </tr>
            </tbody>
          </table>
        </figure>
      </div>
    </div>
  </div>
</template>

<script setup>
import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";

const authenticationStore = AuthenticationStore();

const tokens = ref([]);
const newTokenName = ref("");
const createdToken = ref("");
const createdTokenName = ref("");
const curlExample = ref("");
const curlCopied = ref(false);
const testResult = ref(null);

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

function buildCurlExample(serverUrl) {
  const payload = JSON.stringify({
    title: "Test notification",
    body: "Sent from the Notifications API keys page",
    source: createdTokenName.value || "my-app",
    severity: "info",
  });
  return [
    `curl -X POST ${window.location.origin}${serverUrl}/notifications`,
    `-H "Authorization: Bearer ${createdToken.value}"`,
    '-H "Content-Type: application/json"',
    `-d '${payload}'`,
  ].join(" ");
}

async function copyCurlExample() {
  try {
    await navigator.clipboard.writeText(curlExample.value);
    curlCopied.value = true;
    setTimeout(() => {
      curlCopied.value = false;
    }, 2000);
  } catch (err) {
    console.error("Failed to copy curl example", err);
  }
}

async function sendTestNotification() {
  testResult.value = null;
  try {
    const serverUrl = (await Config.get()).SERVER_URL;
    await axios.post(
      `${serverUrl}/notifications`,
      {
        title: "Test notification",
        body: "Sent from the Notifications API keys page",
        source: createdTokenName.value || "my-app",
        severity: "info",
      },
      { headers: { Authorization: `Bearer ${createdToken.value}` } },
    );
    testResult.value = {
      ok: true,
      message: "Test notification sent — it is now in your feed.",
    };
  } catch (err) {
    testResult.value = {
      ok: false,
      message: err.response?.data?.error || "Test notification failed",
    };
  }
}

async function loadTokens() {
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/tokens`,
      headers,
    );
    tokens.value = res.data.tokens;
  } catch (err) {
    console.error("Failed to load API keys", err);
  }
}

async function createToken() {
  createdToken.value = "";
  testResult.value = null;
  try {
    const serverUrl = (await Config.get()).SERVER_URL;
    const headers = await AuthService.getAuthHeader();
    const res = await axios.post(
      `${serverUrl}/tokens`,
      { name: newTokenName.value },
      headers,
    );
    createdToken.value = res.data.token;
    createdTokenName.value = res.data.name || "";
    curlExample.value = buildCurlExample(serverUrl);
    newTokenName.value = "";
    loadTokens();
  } catch (err) {
    console.error("Failed to create API key", err);
  }
}

async function deleteToken(id) {
  if (
    !window.confirm(
      "Delete this API key? Integrations using it will stop working.",
    )
  ) {
    return;
  }
  try {
    const headers = await AuthService.getAuthHeader();
    await axios.delete(
      `${(await Config.get()).SERVER_URL}/tokens/${id}`,
      headers,
    );
    loadTokens();
  } catch (err) {
    console.error("Failed to delete API key", err);
  }
}

onMounted(async () => {
  if (await authenticationStore.ensureAuthenticated()) {
    loadTokens();
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

#api-keys-page {
  padding: var(--space-sm);
}

.created-token {
  margin-bottom: var(--space-base);
}

.created-token code {
  display: block;
  padding: var(--space-sm);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  word-break: break-all;
  font-size: var(--font-sm);
}

.curl-example {
  margin-top: var(--space-base);
}

.curl-example .form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.test-success {
  color: var(--color-success);
}

.form-error {
  color: var(--color-danger);
}
</style>
