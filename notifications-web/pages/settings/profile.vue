<template>
  <div class="page">
    <div id="profile-page">
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
          <p v-if="error" class="form-error">{{ error }}</p>
        </article>
      </div>

      <div v-else-if="!authenticationStore.isAuthenticated">
        <h3><i class="bi bi-box-arrow-in-right"></i> Login</h3>
        <article>
          <LoginForm @authenticated="onAuthenticated" />
        </article>
      </div>

      <div v-else id="profile-account">
        <h3><i class="bi bi-person-check-fill"></i> Account</h3>
        <article>
          <p>
            Logged in as <strong>{{ userName }}</strong
            >.
          </p>
          <button class="secondary" @click="logout">
            <i class="bi bi-box-arrow-right"></i> Logout
          </button>
        </article>

        <h4><i class="bi bi-shield-lock-fill"></i> Change Password</h4>
        <article>
          <label>
            Current Password
            <input type="password" v-model="passwordOld" placeholder="Enter current password" />
          </label>
          <label>
            New Password
            <input type="password" v-model="newPassword" placeholder="Enter new password" />
          </label>
          <button @click="changePassword" :disabled="!passwordOld || !newPassword">
            Update Password
          </button>
          <p v-if="passwordError" class="form-error">{{ passwordError }}</p>
        </article>
      </div>

      <div id="profile-preferences">
        <h4><i class="bi bi-circle-half"></i> Theme</h4>
        <article>
          <div class="theme-options" role="radiogroup" aria-label="Theme preference">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              class="secondary theme-option"
              :class="{ selected: preference === option.value }"
              :aria-pressed="preference === option.value"
              @click="setTheme(option.value)"
            >
              <i :class="option.icon"></i> {{ option.label }}
            </button>
          </div>
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

// Shared theme composable (light/dark/system) from @devopsplaybook.io/common-web
const { preference, setTheme } = useTheme();

const themeOptions = [
  { value: "light", label: "Light", icon: "bi bi-sun-fill" },
  { value: "dark", label: "Dark", icon: "bi bi-moon-fill" },
  { value: "system", label: "System", icon: "bi bi-circle-half" },
];

const authenticationStore = AuthenticationStore();
const router = useRouter();

const userName = ref("");
const name = ref("");
const password = ref("");
const passwordOld = ref("");
const newPassword = ref("");
const error = ref("");
const passwordError = ref("");
const initialized = ref(true);

// The login form lives in components/LoginForm.vue; this helper only bridges
// the create-admin bootstrap, which reuses the profile fields below.
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
      userName.value = await AuthService.getUserName();
    }
  } catch (err) {
    error.value = err.response?.data?.error || "Login failed";
  }
}

function onAuthenticated() {
  userName.value = "";
  router.push("/");
}

async function createUser() {
  error.value = "";
  try {
    await axios.post(`${(await Config.get()).SERVER_URL}/users`, {
      name: name.value,
      password: password.value,
    });
    await login();
    router.push("/");
  } catch (err) {
    error.value = err.response?.data?.error || "Failed to create user";
  }
}

async function logout() {
  // Revoke all sessions server-side (best effort; local cleanup regardless)
  try {
    const headers = await AuthService.getAuthHeader();
    await axios.post(
      `${(await Config.get()).SERVER_URL}/users/logout`,
      {},
      headers,
    );
  } catch (err) {
    console.error("Failed to revoke sessions", err);
  }
  await AuthService.removeToken();
  authenticationStore.isAuthenticated = false;
  userName.value = "";
  name.value = "";
  password.value = "";
}

async function changePassword() {
  passwordError.value = "";
  try {
    const headers = await AuthService.getAuthHeader();
    const res = await axios.put(
      `${(await Config.get()).SERVER_URL}/users/password`,
      { passwordOld: passwordOld.value, password: newPassword.value },
      headers,
    );
    if (res.data.token) {
      await AuthService.saveToken(res.data.token);
    }
    passwordOld.value = "";
    newPassword.value = "";
  } catch (err) {
    passwordError.value =
      err.response?.data?.error || "Failed to change password";
  }
}

onMounted(async () => {
  initialized.value = await UserService.isInitialized();
  if (await authenticationStore.ensureAuthenticated()) {
    userName.value = await AuthService.getUserName();
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  overflow-y: auto;
}

#profile-page {
  max-width: 480px;
  margin: 0 auto;
  padding: var(--space-xl);
}

.form-error {
  color: var(--color-danger);
}

.theme-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.theme-option {
  flex: 1 1 auto;
  min-width: 6rem;
}

.theme-option.selected {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}
</style>
