import axios from "axios";
import { jwtDecode } from "jwt-decode";

const AUTH_TOKEN_KEY = "auth_token";

// Sliding session: store tokens renewed by the server ("X-Renewed-Token"
// response header) so active users stay logged in
axios.interceptors.response.use((response) => {
  const renewedToken = response.headers["x-renewed-token"];
  if (renewedToken) {
    AuthService.saveToken(renewedToken);
  }
  return response;
});

export class AuthService {
  public static async isAuthenticated(): Promise<boolean> {
    if (await AuthService.getToken()) {
      return true;
    } else {
      return false;
    }
  }

  public static async saveToken(token: string): Promise<void> {
    await localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  public static async removeToken(): Promise<void> {
    await localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  public static async getToken() {
    const storedKey = localStorage.getItem(AUTH_TOKEN_KEY);
    if (storedKey) {
      const decoded = jwtDecode(storedKey);
      if ((decoded as any).exp < Date.now() / 1000) {
        console.log("Auth token expired");
        localStorage.removeItem(AUTH_TOKEN_KEY);
        return null;
      }
      return storedKey;
    } else {
      return null;
    }
  }

  public static async getAuthHeader(): Promise<any> {
    try {
      const token = await AuthService.getToken();
      if (token) {
        return {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        };
      } else {
        return {};
      }
    } catch (error) {
      return {};
    }
  }
}
