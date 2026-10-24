import { FastifyInstance, RequestGenericInterface } from "fastify";
import { User } from "../model/User";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGenerateJWT, AuthGetUserSession } from "./Auth";
import {
  UserPasswordCheckPassword,
  UserPasswordCheckUnknownUser,
  UserPasswordSetPassword,
} from "./UserPassword";
import { AuthRateLimit } from "./AuthRateLimit";
import {
  UsersDataAdd,
  UsersDataBumpTokenVersion,
  UsersDataGet,
  UsersDataGetByName,
  UsersDataList,
  UsersDataUpdate,
} from "./UsersData";

let creatingInitialUser = false;

// users.name is VARCHAR(100): SQLite ignores the bound but Postgres rejects
// longer values, so the API enforces it.
const USER_NAME_MAX_LENGTH = 100;

// Applies to new and changed passwords only; existing shorter passwords keep
// working at login (no lockout).
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MIN_ERROR = `Invalid: Password (minimum ${PASSWORD_MIN_LENGTH} characters)`;

function IsValidNewPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= PASSWORD_MIN_LENGTH;
}

export class UsersRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get("/status/initialization", async (req, res) => {
      const initialized = (await UsersDataList(OTelRequestSpan(req))).length > 0;
      return res.status(200).send({ initialized });
    });

    interface PostSession extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostSession>("/session", async (req, res) => {
      // A request carrying a valid session is a token refresh, not a login
      // attempt: it is re-issued without consuming the login rate-limit bucket.
      const userSession = await AuthGetUserSession(req);
      if (userSession.isAuthenticated) {
        const user = await UsersDataGet(OTelRequestSpan(req), userSession.userId);
        if (!user) {
          return res.status(401).send({ error: "Authentication Failed" });
        }
        return res
          .status(201)
          .send({ success: true, token: await AuthGenerateJWT(user) });
      }

      if (!AuthRateLimit(req, req.body?.name, "login")) {
        return res
          .header("Retry-After", "60")
          .status(429)
          .send({ error: "Too many authentication attempts" });
      }

      if (!req.body?.name) {
        return res.status(400).send({ error: "Missing: Name" });
      }
      if (!req.body?.password) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      const user = await UsersDataGetByName(
        OTelRequestSpan(req),
        req.body.name,
      );
      if (!user) {
        await UserPasswordCheckUnknownUser(
          OTelRequestSpan(req),
          req.body.password,
        );
        return res.status(401).send({ error: "Authentication Failed" });
      } else if (
        await UserPasswordCheckPassword(
          OTelRequestSpan(req),
          user,
          req.body.password,
        )
      ) {
        return res
          .status(201)
          .send({ success: true, token: await AuthGenerateJWT(user) });
      } else {
        return res.status(401).send({ error: "Authentication Failed" });
      }
    });

    interface PostUser extends RequestGenericInterface {
      Body: {
        name: string;
        password: string;
      };
    }
    fastify.post<PostUser>("/", async (req, res) => {
      if (!AuthRateLimit(req, req.body?.name, "registration")) {
        return res
          .header("Retry-After", "60")
          .status(429)
          .send({ error: "Too many registration attempts" });
      }
      if (creatingInitialUser) {
        return res.status(409).send({ error: "Initial user creation in progress" });
      }
      creatingInitialUser = true;
      try {
        if ((await UsersDataList(OTelRequestSpan(req))).length > 0) {
          return res.status(403).send({ error: "Account creation is closed" });
        }
        const newUser = new User();
        const rawName: unknown = req.body?.name;
        const name = typeof rawName === "string" ? rawName.trim() : "";
        if (name === "") {
          return res.status(400).send({ error: "Missing: Name" });
        }
        if (!req.body?.password) {
          return res.status(400).send({ error: "Missing: Password" });
        }
        if (!IsValidNewPassword(req.body.password)) {
          return res.status(400).send({ error: PASSWORD_MIN_ERROR });
        }
        if (name.length > USER_NAME_MAX_LENGTH) {
          return res.status(400).send({ error: "Invalid: Name" });
        }
        if (await UsersDataGetByName(OTelRequestSpan(req), name)) {
          return res.status(400).send({ error: "Username Already Exists" });
        }
        newUser.name = name;
        await UserPasswordSetPassword(
          OTelRequestSpan(req),
          newUser,
          req.body.password,
        );
        await UsersDataAdd(OTelRequestSpan(req), newUser);
        return res.status(201).send({});
      } finally {
        creatingInitialUser = false;
      }
    });

    interface PutNewPassword extends RequestGenericInterface {
      Body: {
        password: string;
        passwordOld: string;
      };
    }
    fastify.put<PutNewPassword>("/password", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const user = await UsersDataGet(OTelRequestSpan(req), userSession.userId);
      if (!req.body?.password || !req.body?.passwordOld) {
        return res.status(400).send({ error: "Missing: Password" });
      }
      // Enforced before the old-password check: avoids bcrypt work and does
      // not reveal old-password validity to an invalid request.
      if (!IsValidNewPassword(req.body.password)) {
        return res.status(400).send({ error: PASSWORD_MIN_ERROR });
      }
      if (
        !(await UserPasswordCheckPassword(
          OTelRequestSpan(req),
          user,
          req.body.passwordOld,
        ))
      ) {
        return res.status(403).send({ error: "Old Password Wrong" });
      }
      await UserPasswordSetPassword(
        OTelRequestSpan(req),
        user,
        req.body.password,
      );
      await UsersDataUpdate(OTelRequestSpan(req), user);
      // Changing the password revokes every other session; the caller gets a
      // freshly issued token bound to the new token version.
      await UsersDataBumpTokenVersion(OTelRequestSpan(req), user.id);
      const updated = await UsersDataGet(OTelRequestSpan(req), user.id);
      if (!updated) {
        return res.status(401).send({ error: "Authentication Failed" });
      }
      return res.status(201).send({
        success: true,
        token: await AuthGenerateJWT(updated),
      });
    });

    // Logout revokes every session/token of the user (revoke-all devices):
    // sessions bound to the previous token version stop authenticating.
    fastify.post("/logout", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      await UsersDataBumpTokenVersion(OTelRequestSpan(req), userSession.userId);
      return res.status(200).send({ success: true });
    });
  }
}
