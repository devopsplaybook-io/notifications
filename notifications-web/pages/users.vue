<template>
  <div class="page">
    <div id="users-page">
      <div v-if="!initialized">
        <h3><i class="bi bi-person-plus-fill"></i> Create Admin User</h3>
        <article>
          <label>
            Username
            <input type="text" v-model="name" placeholder="Enter username" />
          </label>
          <label>
            Password
            <input type="password" v-model="password" placeholder="Enter password" />
          </label>
          <button @click="createUser" :disabled="!name || !password">Create</button>
          <p v-if="error" style="color: var(--color-danger)">{{ error }}</p>
        </article>
      </div>

      <div v-else-if="!authenticationStore.isAuthenticated">
        <h3><i class="bi bi-box-arrow-in-right"></i> Login</h3>
        <article>
          <label>
            Username
            <input type="text" v-model="name" placeholder="Enter username" />
          </label>
          <label>
            Password
            <input type="password" v-model="password" placeholder="Enter password" />
          </label>
          <button @click="login" :disabled="!name || !password">Login</button>
          <p v-if="error" style="color: var(--color-danger)">{{ error }}</p>
        </article>
      </div>

      <div v-else>
        <h3><i class="bi bi-person-check-fill"></i> Logged In</h3>
        <article>
          <p>You are logged in.</p>
          <button class="secondary" @click="logout">
            <i class="bi bi-box-arrow-right"></i> Logout
          </button>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import axios from "axios";
import Config from "~~/services/Config";
import { AuthService } from "~~/services/AuthService";
import { UserService } from "~~/services/UserService";

const authenticationStore = AuthenticationStore();

const name = ref("");
const password = ref("");
const error = ref("");
const initialized = ref(false);

async function login() {
  error.value = "";
  try {
    const res = await axios.post(
      `${(await Config.get()).SERVER_URL}/users/session`,
      { name: name.value, password: password.value },
    );
    if (res.data.token) {
      await AuthService.saveToken(res.data.token);
      authenticationStore.isAuthenticated = true;
      useRouter().push("/");
    }
  } catch (err) {
    error.value = err.response?.data?.error || "Login failed";
  }
}

async function createUser() {
  error.value = "";
  try {
    await axios.post(`${(await Config.get()).SERVER_URL}/users`, {
      name: name.value,
      password: password.value,
    });
    await login();
  } catch (err) {
    error.value = err.response?.data?.error || "Failed to create user";
  }
}

async function logout() {
  await AuthService.removeToken();
  authenticationStore.isAuthenticated = false;
  name.value = "";
  password.value = "";
}

onMounted(async () => {
  initialized.value = await UserService.isInitialized();
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

#users-page {
  max-width: 400px;
  margin: 0 auto;
  padding: var(--space-xl);
}
</style>
