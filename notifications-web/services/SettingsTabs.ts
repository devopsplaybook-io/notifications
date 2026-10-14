export interface SettingsTab {
  id: string;
  label: string;
  to: string;
  exact?: boolean;
}

/**
 * Tabs of the Settings page, listed in display order. The app is
 * single-tenant, so every tab is available to the logged-in user.
 */
export const SettingsTabs: SettingsTab[] = [
  { id: "profile", label: "Profile", to: "/settings/profile", exact: true },
  { id: "api-keys", label: "API Keys", to: "/settings/api-keys" },
  { id: "emails", label: "Email", to: "/settings/emails" },
];
