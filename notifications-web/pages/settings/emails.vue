<template>
  <div class="page">
    <div v-if="!authenticationStore.isAuthenticated" class="empty-state">
      <i class="bi bi-envelope-fill"></i>
      <p>Please login to manage email rules.</p>
    </div>

    <div v-else id="emails-page">
      <h3><i class="bi bi-envelope-fill"></i> Email Rules</h3>

      <div v-if="statusLoaded && !smtpConfigured" class="smtp-banner">
        <i class="bi bi-exclamation-triangle-fill"></i>
        Email is not configured: set the SMTP environment variables
        (<code>SMTP_HOST</code>, <code>SMTP_FROM</code>, …) to enable
        deliveries. Rules can still be created.
      </div>

      <article>
        <header>
          <h4>{{ editingRuleId ? "Edit Rule" : "Add Rule" }}</h4>
        </header>
        <section>
          <label>
            Service
            <input
              type="text"
              v-model="formSource"
              list="known-sources"
              placeholder="Any service"
            />
            <datalist id="known-sources">
              <option v-for="source in knownSources" :key="source" :value="source"></option>
            </datalist>
          </label>
          <label>
            Severity
            <select v-model="formSeverity">
              <option v-for="option in severityOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            Recipient
            <input
              type="email"
              v-model="formRecipient"
              placeholder="who@example.com"
            />
          </label>
          <div class="form-actions">
            <button @click="saveRule" :disabled="!formRecipient">
              {{ editingRuleId ? "Update" : "Add" }}
            </button>
            <button v-if="editingRuleId" class="secondary" @click="resetForm">
              Cancel
            </button>
          </div>
          <p>New notifications matching the rule are emailed to the recipient.</p>
        </section>
      </article>

      <div v-if="rules.length === 0" class="empty-state">
        <i class="bi bi-envelope"></i>
        <p>No email rules yet.</p>
      </div>

      <div v-else id="email-rules-list">
        <figure>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Severity</th>
                <th>Recipient</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rule in rules" :key="rule.id">
                <td>{{ rule.source || "Any" }}</td>
                <td>{{ severityLabel(rule) }}</td>
                <td>{{ rule.recipient }}</td>
                <td>{{ formatDate(rule.createdAt) }}</td>
                <td class="actions">
                  <i class="bi bi-pencil-fill" @click="startEdit(rule)" title="Edit"></i>
                  <i class="bi bi-trash-fill" @click="deleteRule(rule.id)" title="Delete"></i>
                </td>
              </tr>
            </tbody>
          </table>
        </figure>
      </div>

      <article id="email-deliveries">
        <header>
          <h4>Recent Deliveries</h4>
        </header>
        <section>
          <p v-if="deliveriesError" class="form-error">{{ deliveriesError }}</p>
          <div v-if="deliveries.length === 0" class="empty-state">
            <i class="bi bi-envelope"></i>
            <p>No email deliveries yet.</p>
          </div>
          <figure v-else>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Recipient</th>
                  <th>Notification</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="delivery in deliveries" :key="delivery.id">
                  <td>{{ formatRelativeTime(delivery.createdAt) }}</td>
                  <td>{{ delivery.recipient }}</td>
                  <td>{{ delivery.notificationTitle || "—" }}</td>
                  <td>
                    <span :class="delivery.status === 'sent' ? 'status-sent' : 'status-failed'">
                      {{ delivery.status === "sent" ? "✓ sent" : "✗ failed" }}
                    </span>
                  </td>
                  <td>
                    <span v-if="delivery.status !== 'sent'">{{ delivery.error }}</span>
                    <span v-if="delivery.attempts > 1">
                      {{ delivery.attempts }} attempts
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </figure>
          <button class="secondary" @click="loadDeliveries">Refresh</button>
        </section>
      </article>

      <article id="test-email">
        <header><h4>Send Test Email</h4></header>
        <section>
          <label>
            Recipient
            <input type="email" v-model="testRecipient" placeholder="who@example.com" />
          </label>
          <button @click="sendTestEmail" :disabled="!testRecipient || !smtpConfigured">
            Send Test
          </button>
          <p v-if="testResult" :class="testResult.ok ? 'test-success' : 'form-error'">
            {{ testResult.message }}
          </p>
        </section>
      </article>
    </div>
  </div>
</template>

<script setup>
import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";
import { formatRelativeTime } from "~/services/NotificationFormat";
import { AlertsStore } from "~/stores/AlertsStore";

const authenticationStore = AuthenticationStore();
const alertsStore = AlertsStore();

// Threshold options carry a ":threshold" suffix so a single select drives both
// the rule severity and its severityMode.
const SEVERITY_THRESHOLD_SUFFIX = ":threshold";
const severityOptions = [
  { value: "", label: "Any severity" },
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning (exact)" },
  { value: `warning${SEVERITY_THRESHOLD_SUFFIX}`, label: "Warning and above" },
  { value: "error", label: "Error (exact)" },
  { value: `error${SEVERITY_THRESHOLD_SUFFIX}`, label: "Error and above" },
];

const rules = ref([]);
const knownSources = ref([]);
const smtpConfigured = ref(false);
const statusLoaded = ref(false);
const editingRuleId = ref("");
const formSource = ref("");
const formSeverity = ref("");
const formRecipient = ref("");
const testRecipient = ref("");
const testResult = ref(null);
const deliveries = ref([]);
const deliveriesError = ref("");

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

function severityLabel(rule) {
  if (!rule.severity) {
    return "Any";
  }
  return rule.severityMode === "threshold"
    ? `${rule.severity} and above`
    : rule.severity;
}

function formSelectionToPayload() {
  const threshold = formSeverity.value.endsWith(SEVERITY_THRESHOLD_SUFFIX);
  const severity = threshold
    ? formSeverity.value.slice(0, -SEVERITY_THRESHOLD_SUFFIX.length)
    : formSeverity.value;
  return {
    severity,
    severityMode: threshold ? "threshold" : "exact",
  };
}

function resetForm() {
  editingRuleId.value = "";
  formSource.value = "";
  formSeverity.value = "";
  formRecipient.value = "";
}

async function loadStatus() {
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/emails/status`,
      headers,
    );
    smtpConfigured.value = res.data.smtpConfigured;
    statusLoaded.value = true;
  } catch (err) {
    console.error("Failed to load email status", err);
  }
}

async function loadRules() {
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/emails/rules`,
      headers,
    );
    rules.value = res.data.rules;
  } catch (err) {
    console.error("Failed to load email rules", err);
  }
}

async function loadSources() {
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/notifications/sources`,
      headers,
    );
    knownSources.value = res.data.sources;
  } catch (err) {
    console.error("Failed to load notification sources", err);
  }
}

async function saveRule() {
  const { severity, severityMode } = formSelectionToPayload();
  const payload = {
    source: formSource.value.trim(),
    severity,
    severityMode,
    recipient: formRecipient.value.trim(),
  };
  try {
    const headers = await AuthService.getAuthHeader();
    if (editingRuleId.value) {
      await axios.put(
        `${(await Config.get()).SERVER_URL}/emails/rules/${editingRuleId.value}`,
        payload,
        headers,
      );
    } else {
      await axios.post(
        `${(await Config.get()).SERVER_URL}/emails/rules`,
        payload,
        headers,
      );
    }
    resetForm();
    loadRules();
  } catch (err) {
    console.error("Failed to save email rule", err);
    alertsStore.showError(
      err.response?.data?.error || "Failed to save email rule.",
    );
  }
}

function startEdit(rule) {
  editingRuleId.value = rule.id;
  formSource.value = rule.source || "";
  formSeverity.value =
    rule.severityMode === "threshold" && rule.severity
      ? `${rule.severity}${SEVERITY_THRESHOLD_SUFFIX}`
      : rule.severity || "";
  formRecipient.value = rule.recipient || "";
}

async function loadDeliveries() {
  deliveriesError.value = "";
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.get(
      `${(await Config.get()).SERVER_URL}/emails/deliveries`,
      headers,
    );
    deliveries.value = res.data.deliveries;
  } catch (err) {
    console.error("Failed to load email deliveries", err);
    deliveriesError.value =
      err.response?.data?.error || "Failed to load email deliveries";
  }
}

async function deleteRule(id) {
  if (!window.confirm("Delete this email rule?")) {
    return;
  }
  if (editingRuleId.value === id) {
    resetForm();
  }
  try {
    const headers = await AuthService.getAuthHeader();
    await axios.delete(
      `${(await Config.get()).SERVER_URL}/emails/rules/${id}`,
      headers,
    );
    loadRules();
  } catch (err) {
    console.error("Failed to delete email rule", err);
    alertsStore.showError(
      err.response?.data?.error || "Failed to delete email rule.",
    );
  }
}

async function sendTestEmail() {
  testResult.value = null;
  try {
    const headers = await AuthService.getAuthHeader();
    await axios.post(
      `${(await Config.get()).SERVER_URL}/emails/test`,
      { recipient: testRecipient.value.trim() },
      headers,
    );
    testResult.value = { ok: true, message: "Test email sent." };
  } catch (err) {
    testResult.value = {
      ok: false,
      message: err.response?.data?.error || "Test email failed",
    };
  }
}

onMounted(async () => {
  if (await authenticationStore.ensureAuthenticated()) {
    loadStatus();
    loadRules();
    loadSources();
    loadDeliveries();
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

#emails-page {
  padding: var(--space-sm);
}

.smtp-banner {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  margin-bottom: var(--space-base);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  background: var(--color-error-bg);
  color: var(--color-text);
}

.smtp-banner i {
  color: var(--color-warning);
}

.smtp-banner code {
  font-size: var(--font-sm);
}

.form-actions {
  display: flex;
  gap: var(--space-sm);
}

.actions i {
  cursor: pointer;
  margin-left: var(--space-sm);
}

.actions .bi-pencil-fill {
  color: var(--color-text-secondary);
}

.actions .bi-trash-fill {
  color: var(--color-danger);
}

.test-success {
  color: var(--color-success);
}

.form-error {
  color: var(--color-danger);
}

.status-sent {
  color: var(--color-success);
}

.status-failed {
  color: var(--color-danger);
}
</style>
