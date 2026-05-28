/**
 * Environment switching for the test harness. Reads staging + prod
 * credentials from .env.local (EXPO_PUBLIC_* are inlined at build
 * time by Expo's CLI). The active environment is picked at runtime
 * by the UI toggle, so a single binary can drive both targets — no
 * rebuilds when swapping.
 *
 * Production-grade partners would NEVER ship the static secret in
 * the app bundle. This is a dev-only test harness; the README is
 * explicit about that.
 */

export type Environment = "staging" | "prod";

export interface WorknodeEnv {
  label: Environment;
  apiBase: string;
  slug: string;
  secret: string;
}

function read(name: string): string {
  // Cast to Record so TS doesn't flag the dynamic key; Expo replaces
  // these at bundle time.
  const env = process.env as Record<string, string | undefined>;
  return env[name] ?? "";
}

export function loadEnv(target: Environment): WorknodeEnv {
  if (target === "staging") {
    return {
      label: "staging",
      apiBase: read("EXPO_PUBLIC_WORKNODE_STAGING_API_BASE"),
      slug:    read("EXPO_PUBLIC_WORKNODE_STAGING_SLUG"),
      secret:  read("EXPO_PUBLIC_WORKNODE_STAGING_SECRET"),
    };
  }
  return {
    label: "prod",
    apiBase: read("EXPO_PUBLIC_WORKNODE_PROD_API_BASE"),
    slug:    read("EXPO_PUBLIC_WORKNODE_PROD_SLUG"),
    secret:  read("EXPO_PUBLIC_WORKNODE_PROD_SECRET"),
  };
}

/** Quick health check the UI shows before letting you fire. */
export function envIsConfigured(env: WorknodeEnv): boolean {
  return env.apiBase.length > 0 && env.slug.length > 0 && env.secret.length > 0;
}
