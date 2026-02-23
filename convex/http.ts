import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

type BeaconSyncPayload = {
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion?: number | string;
  appVersion?: string;
};

function isBeaconSyncPayload(value: unknown): value is BeaconSyncPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  if (typeof payload.localId !== "string") return false;
  if (typeof payload.name !== "string") return false;
  if (typeof payload.data !== "string") return false;
  if (typeof payload.createdAt !== "number") return false;
  if (typeof payload.updatedAt !== "number") return false;

  if (
    payload.schemaVersion !== undefined &&
    typeof payload.schemaVersion !== "number" &&
    typeof payload.schemaVersion !== "string"
  ) {
    return false;
  }

  if (payload.appVersion !== undefined && typeof payload.appVersion !== "string") {
    return false;
  }

  return true;
}

http.route({
  path: "/sync-beacon",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const rawBody = await req.text();
      const parsed = JSON.parse(rawBody) as unknown;

      if (!isBeaconSyncPayload(parsed)) {
        return new Response("Invalid payload", {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      await ctx.runMutation(internal.projects.syncBeacon, parsed);
      return new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    } catch {
      return new Response("Invalid request", {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
  }),
});

http.route({
  path: "/sync-beacon",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

export default http;
