<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="empty-state">
      <i class="bi bi-key-fill"></i>
      <p>Please login to manage API tokens.</p>
    </div>

    <div v-else id="tokens-page">
      <h3><i class="bi bi-key-fill"></i> API Tokens</h3>

      <article>
        <header><h4>Create New Token</h4></header>
        <section>
          <label>
            Token Name
            <input type="text" v-model="newTokenName" placeholder="e.g. My App" />
          </label>
          <button @click="createToken" :disabled="!newTokenName">Create</button>
        </section>
      </article>

      <div v-if="createdToken" class="created-token">
        <article>
          <header><h4>New Token Created</h4></header>
          <section>
            <p>Copy this token now. It won't be shown again:</p>
            <code>{{ createdToken }}</code>
          </section>
        </article>
      </div>

      <div v-if="tokens.length === 0 && !createdToken" class="empty-state">
        <i class="bi bi-key"></i>
        <p>No API tokens yet.</p>
      </div>

      <div v-else id="tokens-list">
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

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
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
    console.error("Failed to load tokens", err);
  }
}

async function createToken() {
  createdToken.value = "";
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/tokens`,
      { name: newTokenName.value },
      headers,
    );
    createdToken.value = res.data.token;
    newTokenName.value = "";
    loadTokens();
  } catch (err) {
    console.error("Failed to create token", err);
  }
}

async function deleteToken(id) {
  try {
    const headers = await AuthService.getAuthHeader();
    await axios.delete(
      `${(await Config.get()).SERVER_URL}/tokens/${id}`,
      headers,
    );
    loadTokens();
  } catch (err) {
    console.error("Failed to delete token", err);
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

#tokens-page {
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
</style>
