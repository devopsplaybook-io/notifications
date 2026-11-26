import axios from "axios";
import {
  createLoginCodeService,
  type LoginCodeHttpClient,
  type LoginCodeService,
} from "@devopsplaybook.io/common-web/services/LoginCodeService.ts";
import { AuthService } from "~~/services/AuthService";

/**
 * Login-with-code client wired to the app's session: the global axios keeps
 * the X-Renewed-Token interceptor, the base URL stays the common-web default
 * (`Config.SERVER_URL + "/users/login-codes"`, i.e. `/api/users/login-codes`),
 * and a redeemed session is persisted exactly like the password login.
 */
export function createNotificationsLoginCodeService(authenticationStore: {
  isAuthenticated: boolean;
}): LoginCodeService {
  return createLoginCodeService({
    http: axios as unknown as LoginCodeHttpClient,
    getAuthHeader: () => AuthService.getAuthHeader(),
    onSession: async (token: string) => {
      await AuthService.saveToken(token);
      authenticationStore.isAuthenticated = true;
    },
  });
}
