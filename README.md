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

2. **Create the `harness` integration.** In worknode-next, with
   `apps/web/.env.local` (or the staging env) sourced, run:
   ```bash
   pnpm --filter worknode-next exec tsx scripts/create-harness-integration.ts
   ```
   It creates (or rotates) an integration with slug `harness` and return
   URL `worknode-test://callback`, and writes the slug and secret straight
   into this repo's `.env.local`. Re-running it rotates the secret.

   Use the `harness` slug, not a partner's. A partner's return URL is an
   HTTPS endpoint they own, so the in-app browser never sees
   `worknode-test://callback`, never closes, and every run ends as
   `user_cancelled` without the signature ever being checked. It also
   writes test users and invoices under that partner's name.

3. **Check `.env.local`.** See `.env.local.example` for the variable
   names. Each environment has its own secret.

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

"Signed callback verified" means only that the signature (and `state`)
checked out. The harness does not branch on `status`, so `cancelled`,
`interrupted` and `pending_review` are reported the same way — read
`status` in the JSON.

## Failure modes you can deliberately exercise

- **User cancels the in-app browser** → outcome `user_cancelled`. The
  same outcome appears for every run if the integration's return URL is
  not `worknode-test://callback` (see Setup step 2).
  Real partners must offer a Retry which calls session-create again
  for a fresh token; the previous one is single-use and burned.
- **Tamper with the signature** — modify
  `lib/worknode-client.ts:verifyCallback` to pass a wrong secret
  → outcome `verification_failed`, reason `hmac_mismatch`.
- **State mismatch** — temporarily pass a different value as the
  third argument of `verifyCallback(...)` in `lib/flow.ts` (the call
  after the browser returns) → outcome `verification_failed`, reason
  `state_mismatch`. Hard-coding `freshState()` does not do this: the
  value sent, stored and expected stay identical.
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

The signature scheme is specified in the Worknode partner docs, "Verifying
the return URL" — `docs/en/integrate/return-url.mdx` in worknode-next.
If you observe a signature mismatch, check `canonicalize()` in
`lib/worknode-client.ts` against that page. Known gap: `canonicalize()`
keeps only the last value of a repeated key and sorts by key only, whereas
the spec keeps every occurrence and sorts by key then value. That only
matters for a return URL with repeated query keys, which
`worknode-test://callback` does not have.
