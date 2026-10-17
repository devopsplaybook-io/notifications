<template>
  <form id="login-form" @submit.prevent="submit">
    <label>
      Username
      <input
        type="text"
        v-model="name"
        placeholder="Enter username"
        autocomplete="username"
      />
    </label>
    <label>
      Password
      <input
        type="password"
        v-model="password"
        placeholder="Enter password"
        autocomplete="current-password"
      />
    </label>
    <button type="submit" :disabled="!name || !password || busy">Login</button>
    <p v-if="error" class="form-error">{{ error }}</p>
  </form>
</template>

<script setup>
import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";

const emit = defineEmits(["authenticated"]);

const authenticationStore = AuthenticationStore();
const name = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  if (busy.value || !name.value || !password.value) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/users/session`,
      { name: name.value, password: password.value },
    );
    if (res.data.token) {
      await AuthService.saveToken(res.data.token);
      authenticationStore.isAuthenticated = true;
      emit("authenticated");
    }
  } catch (err) {
    error.value = err.response?.data?.error || "Login failed";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.form-error {
  color: var(--color-danger);
}
</style>
