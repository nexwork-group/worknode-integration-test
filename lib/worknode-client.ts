/**
 * Thin client for the Worknode integration API. Mirrors what a partner
 * backend would do — token exchange, session create, HMAC verify on
 * the callback.
 *
 * The HMAC canonical-string format is: alphabetical keys, `signature`
 * excluded, joined as `k=v&k=v`, values NOT URL-encoded. This matches
 * the spec in the Worknode partner integration guide PDF.
 */

import CryptoJS from "crypto-js";
import { WorknodeEnv } from "./config";

export interface AccessTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

export interface SessionCreateRequest {
  external_id: string;
  personnummer: string;
  full_name: string;
  email: string;
  phone?: string;
  /** Optional partner-supplied CSRF / session-reconciliation value. */
  state?: string;
}

export interface SessionCreateResponse {
  redirect_url: string;
  expires_at: string;
  worknode_user_id: string;
  created: boolean;
}

export class WorknodeApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`Worknode API error ${status}: ${JSON.stringify(body)}`);
    this.name = "WorknodeApiError";
  }
}

/** POST /api/integration/token — exchange the static secret for a
 *  short-lived access JWT. A real partner caches this; the test
 *  harness re-fetches every flow so each run is independent. */
export async function fetchAccessToken(
  env: WorknodeEnv
): Promise<AccessTokenResponse> {
  const res = await fetch(`${env.apiBase}/api/integration/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.secret}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new WorknodeApiError(res.status, body);
  return body as AccessTokenResponse;
}

/** POST /api/integration/session — mint a redirect_url for the user. */
export async function createSession(
  env: WorknodeEnv,
  accessToken: string,
  payload: SessionCreateRequest
): Promise<SessionCreateResponse> {
  const res = await fetch(`${env.apiBase}/api/integration/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new WorknodeApiError(res.status, body);
  return body as SessionCreateResponse;
}

/** Canonical string the server uses to sign the return URL. Keys
 *  sorted alphabetically, `signature` excluded, joined as `k=v&k=v`,
 *  values NOT URL-encoded. Must match the spec in the Worknode partner
 *  integration guide PDF byte-for-byte. */
export function canonicalize(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

export interface CallbackVerification {
  valid: boolean;
  /** When valid, the parsed params (signature stripped). */
  params: Record<string, string>;
  /** Diagnostic when invalid. */
  reason?:
    | "no_signature"
    | "hmac_mismatch"
    | "state_mismatch"
    | "invalid_url";
}

/** Verify the callback URL the in-app browser handed back.
 *
 *  - Recomputes HMAC-SHA256 over the canonical string with the
 *    integration secret and compares constant-time to the signature
 *    param.
 *  - If `expectedState` is provided, also checks the echoed state
 *    matches exactly. This is the CSRF / session-reconciliation
 *    check the partner guide §7 recommends — HMAC alone is not
 *    enough on a multi-device install. */
export function verifyCallback(
  callbackUrl: string,
  secret: string,
  expectedState?: string
): CallbackVerification {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    return { valid: false, params: {}, reason: "invalid_url" };
  }

  const params: Record<string, string> = {};
  parsed.searchParams.forEach((v, k) => {
    params[k] = v;
  });

  const signature = params["signature"];
  if (!signature) {
    return { valid: false, params, reason: "no_signature" };
  }

  const canonical = canonicalize(params);
  const expectedHex = CryptoJS.HmacSHA256(canonical, secret).toString(
    CryptoJS.enc.Hex
  );

  if (!constantTimeEquals(expectedHex, signature)) {
    return { valid: false, params, reason: "hmac_mismatch" };
  }

  if (expectedState !== undefined && params["state"] !== expectedState) {
    return { valid: false, params, reason: "state_mismatch" };
  }

  // Strip signature from the returned params so callers can't accidentally
  // re-use it elsewhere.
  const { signature: _sig, ...rest } = params;
  return { valid: true, params: rest };
}

/** Constant-time hex string comparison. Native crypto.timingSafeEqual
 *  isn't available in React Native; this is the standard JS fallback. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
