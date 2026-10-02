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
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }

  public static toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(UI_THEME, next);
  }
}
