/**
 * End-to-end orchestration of the partner handoff. Wraps:
 *   1. POST /api/integration/token
 *   2. POST /api/integration/session  (with a fresh per-flow state)
 *   3. WebBrowser.openAuthSessionAsync (ASWebAuthenticationSession
 *      on iOS, Chrome Custom Tabs on Android)
 *   4. Verify HMAC + state on the callback URL
 *
 * The shape returned by `runFlow` is what the UI binds to —
 * one object per run, success or failure.
 */

import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import { WorknodeEnv } from "./config";
import {
  fetchAccessToken,
  createSession,
  verifyCallback,
  WorknodeApiError,
  SessionCreateRequest,
} from "./worknode-client";

const CALLBACK_SCHEME = "worknode-test://callback";

export type FlowOutcome =
  | {
      kind: "success";
      params: Record<string, string>;
      state: string;
      worknodeUserId: string;
      created: boolean;
      durationMs: number;
    }
  | {
      kind: "user_cancelled";
      state: string;
      durationMs: number;
    }
  | {
      kind: "verification_failed";
      reason: string;
      callbackUrl: string;
      state: string;
      durationMs: number;
    }
  | {
      kind: "api_error";
      stage: "token" | "session";
      status: number;
      body: unknown;
      durationMs: number;
    }
  | {
      kind: "unknown_error";
      message: string;
      durationMs: number;
    };

export interface FlowInput {
  env: WorknodeEnv;
  identity: Omit<SessionCreateRequest, "state">;
}

/** Cryptographically random per-session state. expo-crypto's
 *  randomUUID is native on both platforms so it's safe to rely on. */
function freshState(): string {
  return Crypto.randomUUID();
}

export async function runFlow(input: FlowInput): Promise<FlowOutcome> {
  const start = Date.now();
  const state = freshState();

  // 1) Token exchange
  let accessToken: string;
  try {
    const tokenRes = await fetchAccessToken(input.env);
    accessToken = tokenRes.access_token;
  } catch (err) {
    if (err instanceof WorknodeApiError) {
      return {
        kind: "api_error",
        stage: "token",
        status: err.status,
        body: err.body,
        durationMs: Date.now() - start,
      };
    }
    return {
      kind: "unknown_error",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }

  // 2) Session create
  let sessionRes;
  try {
    sessionRes = await createSession(input.env, accessToken, {
      ...input.identity,
      state,
    });
  } catch (err) {
    if (err instanceof WorknodeApiError) {
      return {
        kind: "api_error",
        stage: "session",
        status: err.status,
        body: err.body,
        durationMs: Date.now() - start,
      };
    }
    return {
      kind: "unknown_error",
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }

  // 3) Open in ASWebAuthenticationSession / Chrome Custom Tabs.
  //    The redirect_url is single-use; if any prefetcher hits it
  //    between here and the user landing it's already burned.
  const result = await WebBrowser.openAuthSessionAsync(
    sessionRes.redirect_url,
    CALLBACK_SCHEME
  );

  if (result.type !== "success") {
    return {
      kind: "user_cancelled",
      state,
      durationMs: Date.now() - start,
    };
  }

  // 4) Verify the callback URL. State is always supplied so the
  //    verifier enforces the CSRF / session-reconciliation check.
  const verification = verifyCallback(result.url, input.env.secret, state);

  if (!verification.valid) {
    return {
      kind: "verification_failed",
      reason: verification.reason ?? "unknown",
      callbackUrl: result.url,
      state,
      durationMs: Date.now() - start,
    };
  }

  return {
    kind: "success",
    params: verification.params,
    state,
    worknodeUserId: sessionRes.worknode_user_id,
    created: sessionRes.created,
    durationMs: Date.now() - start,
  };
}
