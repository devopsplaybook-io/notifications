// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

const loginCodeMocks = vi.hoisted(() => ({ capabilities: vi.fn() }));

vi.mock("../utils/loginCodes", () => ({
  createNotificationsLoginCodeService: () => ({
    capabilities: loginCodeMocks.capabilities,
  }),
}));
vi.mock("../services/UserService", () => ({
  UserService: { isInitialized: vi.fn().mockResolvedValue(true) },
}));
vi.mock("../services/PushService", () => ({
  PushService: {
    isSupported: vi.fn().mockResolvedValue(false),
    isSubscribed: vi.fn().mockResolvedValue(false),
    getPermission: vi.fn().mockResolvedValue("denied"),
  },
}));
vi.mock("../services/RenderCache", () => ({
  RenderCache: { renderMarkdown: vi.fn().mockReturnValue("") },
}));
vi.mock("../services/NotificationFormat", () => ({
  extractNotificationUrl: vi.fn().mockReturnValue(null),
  formatAbsoluteTime: vi.fn().mockReturnValue(""),
  formatRelativeTime: vi.fn().mockReturnValue(""),
  isHttpUrl: vi.fn().mockReturnValue(false),
  parseNotificationData: vi.fn().mockReturnValue(null),
}));

import { UserService } from "../services/UserService";
import IndexPage from "../pages/index.vue";

const authenticationStore = {
  isAuthenticated: false,
  ensureAuthenticated: vi.fn().mockResolvedValue(false),
};
const notificationsStore = {
  notifications: [],
  total: 0,
  unreadCount: 0,
  loading: false,
  loaded: false,
  readFilter: "unread",
  sourceFilter: "",
  severityFilter: "",
  searchQuery: "",
  sources: [],
  sourceUnreadCounts: {},
  loadNotifications: vi.fn(),
  loadSources: vi.fn(),
  loadUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  deleteNotification: vi.fn(),
  deleteAll: vi.fn(),
  setSourceFilter: vi.fn(),
  setReadFilter: vi.fn(),
  setSeverityFilter: vi.fn(),
  setSearchQuery: vi.fn(),
  ensureNotificationVisible: vi.fn(),
};

(globalThis as any).ref = ref;
(globalThis as any).computed = computed;
(globalThis as any).onMounted = onMounted;
(globalThis as any).onUnmounted = onUnmounted;
(globalThis as any).nextTick = nextTick;
(globalThis as any).useRoute = () => ({ query: {} });
(globalThis as any).useRouter = () => ({ replace: vi.fn() });
(globalThis as any).AuthenticationStore = () => authenticationStore;
(globalThis as any).NotificationsStore = () => notificationsStore;

const LoginFormStub = { template: '<form class="login-form-stub" />' };
const LoginWithCodeCardStub = {
  name: "LoginWithCodeCard",
  props: { service: { type: Object, default: null } },
  template: '<section class="login-with-code-card-stub" />',
};
const NuxtLinkStub = { template: '<a><slot /></a>' };
const LoadingStub = { template: '<div class="loading-stub" />' };

const mountOptions = {
  global: {
    components: {
      LoginForm: LoginFormStub,
      LoginWithCodeCard: LoginWithCodeCardStub,
      Loading: LoadingStub,
      NuxtLink: NuxtLinkStub,
    },
  },
};

function toggleButton(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes("Use a code instead"));
}

beforeEach(() => {
  vi.clearAllMocks();
  loginCodeMocks.capabilities.mockResolvedValue({
    enabled: false,
    available: false,
  });
  authenticationStore.isAuthenticated = false;
  authenticationStore.ensureAuthenticated.mockResolvedValue(false);
  vi.mocked(UserService.isInitialized).mockResolvedValue(true);
});

describe("index login gate", () => {
  it("offers the code login when the server reports it available", async () => {
    loginCodeMocks.capabilities.mockResolvedValue({ enabled: true, available: true });
    const wrapper = mount(IndexPage, mountOptions);
    await flushPromises();

    const toggle = toggleButton(wrapper);
    expect(toggle).toBeDefined();
    expect(wrapper.find(".login-form-stub").exists()).toBe(true);

    await toggle!.trigger("click");
    expect(wrapper.find(".login-with-code-card-stub").exists()).toBe(true);
    expect(wrapper.find(".login-form-stub").exists()).toBe(false);
  });

  it("hides the code login when capabilities say unavailable", async () => {
    loginCodeMocks.capabilities.mockResolvedValue({
      enabled: true,
      available: false,
    });
    const wrapper = mount(IndexPage, mountOptions);
    await flushPromises();

    expect(toggleButton(wrapper)).toBeUndefined();
    expect(wrapper.find(".login-form-stub").exists()).toBe(true);
    expect(wrapper.find(".login-with-code-card-stub").exists()).toBe(false);
  });

  it("hides the code login when the capabilities probe fails", async () => {
    loginCodeMocks.capabilities.mockRejectedValue({ response: { status: 404 } });
    const wrapper = mount(IndexPage, mountOptions);
    await flushPromises();

    expect(toggleButton(wrapper)).toBeUndefined();
    expect(wrapper.find(".login-form-stub").exists()).toBe(true);
  });
});
