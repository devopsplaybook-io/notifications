const UI_THEME = "UI_THEME";
const PUSH_ENABLED = "push_enabled";

export class PreferencesService {
  public static isPushEnabled(): boolean {
    return localStorage.getItem(PUSH_ENABLED) === "true";
  }

  public static setPushEnabled(enabled: boolean): void {
    localStorage.setItem(PUSH_ENABLED, enabled ? "true" : "false");
  }

  public static applyTheme() {
    const saved = localStorage.getItem(UI_THEME);
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }
}
