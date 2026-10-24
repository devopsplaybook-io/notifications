// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onMounted, ref } from "vue";

vi.mock("axios", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("../services/Config", () => ({
  default: { get: vi.fn().mockResolvedValue({ SERVER_URL: "/api" }) },
}));
vi.mock("../services/AuthService", () => ({
  AuthService: {
    getAuthHeader: vi.fn().mockResolvedValue({
      headers: { authorization: "Bearer session" },
    }),
    getUserName: vi.fn().mockResolvedValue("admin"),
    saveToken: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../services/UserService", () => ({
  UserService: { isInitialized: vi.fn().mockResolvedValue(true) },
}));

import axios from "axios";
import { AuthService } from "../services/AuthService";
import { UserService } from "../services/UserService";
import ProfilePage from "../pages/settings/profile.vue";

const authenticationStore = {
  isAuthenticated: false,
  ensureAuthenticated: vi.fn().mockResolvedValue(false),
};

// Nuxt auto-imports these in the app; provide minimal fakes as globals so the
// page under test resolves them the same way it does at runtime.
(globalThis as any).ref = ref;
(globalThis as any).onMounted = onMounted;
(globalThis as any).AuthenticationStore = () => authenticationStore;
(globalThis as any).useTheme = () => ({
  preference: ref("system"),
  setTheme: vi.fn(),
});
(globalThis as any).useRouter = () => ({ push: vi.fn() });

const mockedPost = vi.mocked(axios.post);
const mockedPut = vi.mocked(axios.put);

// LoginForm is a Nuxt auto-imported component; stub it for the mount.
const mountOptions = { global: { stubs: { LoginForm: true } } };

beforeEach(() => {
  vi.clearAllMocks();
  mockedPost.mockReset();
  mockedPut.mockReset();
  authenticationStore.isAuthenticated = false;
  authenticationStore.ensureAuthenticated.mockResolvedValue(false);
  vi.mocked(UserService.isInitialized).mockResolvedValue(true);
});

describe("profile page password policy", () => {
  it("disables Create until the password has 12 characters and posts it", async () => {
    vi.mocked(UserService.isInitialized).mockResolvedValue(false);
    const wrapper = mount(ProfilePage, mountOptions);
    await flushPromises();

    await wrapper.find('input[type="text"]').setValue("admin");
    const passwordInput = wrapper.find('input[type="password"]');
    await passwordInput.setValue("a".repeat(11));

    const createButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Create")!;
    expect(createButton.attributes("disabled")).toBeDefined();

    await passwordInput.setValue("a".repeat(12));
    expect(createButton.attributes("disabled")).toBeUndefined();
    expect(passwordInput.attributes("minlength")).toBe("12");

    mockedPost.mockImplementation(async (url: string) =>
      url.endsWith("/users/session")
        ? { data: { token: "session-token" } }
        : { data: {} },
    );
    await createButton.trigger("click");
    await flushPromises();

    expect(mockedPost).toHaveBeenCalledWith("/api/users", {
      name: "admin",
      password: "a".repeat(12),
    });
    expect(vi.mocked(AuthService.saveToken)).toHaveBeenCalledWith(
      "session-token",
    );
  });

  it("disables Update Password until the new password has 12 characters and puts it", async () => {
    authenticationStore.isAuthenticated = true;
    authenticationStore.ensureAuthenticated.mockResolvedValue(true);
    const wrapper = mount(ProfilePage, mountOptions);
    await flushPromises();

    const passwordInputs = wrapper.findAll('#profile-account input[type="password"]');
    expect(passwordInputs).toHaveLength(2);
    await passwordInputs[0]!.setValue("old-password");
    await passwordInputs[1]!.setValue("a".repeat(11));

    const updateButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "Update Password")!;
    expect(updateButton.attributes("disabled")).toBeDefined();

    await passwordInputs[1]!.setValue("a".repeat(12));
    expect(updateButton.attributes("disabled")).toBeUndefined();
    expect(passwordInputs[1]!.attributes("minlength")).toBe("12");

    mockedPut.mockResolvedValueOnce({ data: { token: "new-session" } });
    await updateButton.trigger("click");
    await flushPromises();

    expect(mockedPut).toHaveBeenCalledWith(
      "/api/users/password",
      { passwordOld: "old-password", password: "a".repeat(12) },
      { headers: { authorization: "Bearer session" } },
    );
    expect(vi.mocked(AuthService.saveToken)).toHaveBeenCalledWith("new-session");
  });
});
