import { FastifyInstance, RequestGenericInterface } from "fastify";
import { OTelRequestSpan } from "../OTelContext";
import { AuthGetUserSession } from "../users/Auth";
import {
  ApiTokensList,
  ApiTokensCreate,
  ApiTokensDelete,
} from "./ApiTokensData";

export class ApiTokensRoutes {
  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    // List API tokens (requires user auth)
    fastify.get("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const tokens = await ApiTokensList(OTelRequestSpan(req));
      return res.status(200).send({ tokens });
    });

    // Create API token (requires user auth)
    interface PostToken extends RequestGenericInterface {
      Body: {
        name: string;
      };
    }
    fastify.post<PostToken>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      if (!req.body.name) {
        return res.status(400).send({ error: "Missing: name" });
      }
      const token = await ApiTokensCreate(OTelRequestSpan(req), req.body.name);
      return res.status(201).send(token);
    });

    // Delete API token (requires user auth)
    fastify.delete("/:id", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(403).send({ error: "Access Denied" });
      }
      const { id } = req.params as { id: string };
      await ApiTokensDelete(OTelRequestSpan(req), id);
      return res.status(200).send({ success: true });
    });
  }
}
