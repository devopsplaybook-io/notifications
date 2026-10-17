// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));
vi.mock("../services/Config", () => ({
  default: { get: vi.fn().mockResolvedValue({ SERVER_URL: "/api" }) },
}));
vi.mock("../services/AuthService", () => ({
  AuthService: {
    saveToken: vi.fn().mockResolvedValue(undefined),
  },
}));

import axios from "axios";
import LoginForm from "../components/LoginForm.vue";
import { AuthService } from "../services/AuthService";

// Nuxt auto-imports these in the app; provide minimal fakes as globals so the
// component under test resolves them the same way it does at runtime.
(globalThis as any).ref = ref;
const authenticationStoreState = { isAuthenticated: false };
(globalThis as any).AuthenticationStore = () => authenticationStoreState;

const mockedPost = vi.mocked(axios.post);

function mountForm() {
  return mount(LoginForm);
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticationStoreState.isAuthenticated = false;
});

describe("login form", () => {
  it("posts the session, saves the token and reports authentication", async () => {
    mockedPost.mockResolvedValueOnce({ data: { token: "session-token" } });

    const wrapper = mountForm();
    await wrapper.find('input[type="text"]').setValue("admin");
    await wrapper.find('input[type="password"]').setValue("secret");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockedPost).toHaveBeenCalledWith("/api/users/session", {
      name: "admin",
      password: "secret",
    });
    expect(AuthService.saveToken).toHaveBeenCalledWith("session-token");
    expect(authenticationStoreState.isAuthenticated).toBe(true);
    expect(wrapper.emitted("authenticated")).toHaveLength(1);
    expect(wrapper.find(".form-error").exists()).toBe(false);
  });

  it("shows the server error and keeps the form when login fails", async () => {
    mockedPost.mockRejectedValueOnce({
      response: { data: { error: "Access Denied" } },
    });

    const wrapper = mountForm();
    await wrapper.find('input[type="text"]').setValue("admin");
    await wrapper.find('input[type="password"]').setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(AuthService.saveToken).not.toHaveBeenCalled();
    expect(authenticationStoreState.isAuthenticated).toBe(false);
    expect(wrapper.emitted("authenticated")).toBeUndefined();
    expect(wrapper.find(".form-error").text()).toBe("Access Denied");
  });

  it("does not submit with empty credentials", async () => {
    const wrapper = mountForm();
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mockedPost).not.toHaveBeenCalled();
  });
});
