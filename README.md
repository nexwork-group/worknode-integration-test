# worknode-integration-test

Dev-only Expo harness for end-to-end testing the Worknode hosted-handoff
flow against both staging and production. Mimics what a partner mobile
app does: token exchange → session create → open in
ASWebAuthenticationSession / Chrome Custom Tabs → verify signed
callback → confirm `state` round-trips.

> **This is not how a real partner ships.** The static integration
> secret lives in this app's bundle for convenience. A production
> partner keeps the secret on a backend and the mobile app calls the
> backend, which calls Worknode. The flow on the device is identical
> either way — only where the secret lives changes.

## Setup

1. **Install** (already done by the scaffolder):
   ```bash
   npm install
   ```

2. **Get your credentials from Worknode.** Email `tech@worknode.se`
   to provision your integration. You'll receive:
   - `WORKNODE_INTEGRATION_SLUG` — your integration identifier
   - `WORKNODE_INTEGRATION_SECRET` — your static bearer secret
   - Confirmation that the return URL on the Worknode side is
     pre-configured to `worknode-test://callback` to match this harness

3. **Fill in `.env.local`** with the credentials from step 2 for both
   environments. See `.env.local.example` for the variable names.

4. **Run** in a simulator or on a real device:
   ```bash
   npm run ios       # iOS simulator (recommended for ASWebAuthSession)
   npm run android   # Android emulator (Chrome Custom Tabs)
   ```

## What the app does

Single screen with two sections:

- **Environment toggle** — staging or production. Reads the matching
  block from `.env.local`. Pinned to production turns the button red.
- **Identity payload** — pre-filled with a test personnummer. Email
  `tech@worknode.se` before running against prod with real values.

Every run sends a fresh OAuth 2.0 `state` (cryptographically random
UUID) and the verifier enforces that the callback's echoed state
matches. This is the recommended production path — there's no
"HMAC-only" toggle because every deployed environment supports state.

Tapping **Run handoff flow**:

1. POSTs to `/api/integration/token` with the static secret →
   access token.
2. POSTs to `/api/integration/session` with the identity payload and
   the freshly-generated `state` → `redirect_url` (single-use, 5-min TTL).
3. Opens the redirect URL via `WebBrowser.openAuthSessionAsync`
   (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android).
4. Catches the `worknode-test://callback?...` redirect.
5. Recomputes HMAC-SHA256 over the canonical query string and
   constant-time-compares to the `signature` param. Verifies `state`
   matches the value sent in step 2.
6. Displays the outcome as a structured JSON blob.

## Failure modes you can deliberately exercise

- **User cancels the in-app browser** → outcome `user_cancelled`.
  Real partners must offer a Retry which calls session-create again
  for a fresh token; the previous one is single-use and burned.
- **Tamper with the signature** — modify
  `lib/worknode-client.ts:verifyCallback` to pass a wrong secret
  → outcome `verification_failed`, reason `hmac_mismatch`.
- **Stale state** — temporarily hard-code a constant string in
  `lib/flow.ts:freshState()` so two runs share a state value; the
  second run's cookie-overwrite means the echoed state won't match
  → outcome `verification_failed`, reason `state_mismatch`.
- **Wrong API base** — temporarily edit `.env.local` to point at a
  4xx host → outcome `api_error` at stage `token` or `session`.

## Files

```
.
├── App.tsx                    # single screen — env toggle, inputs, runner, outcome view
├── lib/
│   ├── config.ts              # staging vs prod env loading
│   ├── worknode-client.ts     # token + session + canonical HMAC verify
│   └── flow.ts                # orchestration (token → session → browser → verify)
├── app.json                   # expo.scheme = "worknode-test"
├── .env.local                 # secrets — gitignored
└── .env.local.example         # template
```

## HMAC canonical-string format

The signature scheme is documented in the Worknode partner integration
guide (PDF) shipped to you by `tech@worknode.se`. If you ever observe a
signature mismatch in production, double-check `canonicalize()` in
`lib/worknode-client.ts` against that spec.
