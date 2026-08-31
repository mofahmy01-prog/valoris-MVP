/**
 * Identity providers.
 *
 * Two of them, and which one is active is decided by configuration rather than
 * by whatever happens to be imported — see `currentProvider()`.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { ROLES, type Actor, type AuthResult, type IdentityProvider, type Role } from "./types";

/** Cookie the development provider reads. */
export const DEV_SESSION_COOKIE = "valoris_dev_session";

/**
 * Development identity, signed so it cannot be edited in the browser.
 *
 * Signing is not security theatre here — without it, a session cookie is just a
 * string the holder can rewrite, and a "role" field would be self-declared
 * exactly like the actor labels this seam exists to replace. It is still NOT
 * production-grade: there is no password, no expiry beyond the cookie's own, no
 * revocation, and the signing secret comes from the environment with a
 * development fallback.
 */
export class DevIdentityProvider implements IdentityProvider {
  readonly name = "development";
  readonly isProductionGrade = false;
  readonly disclosure =
    "Development identity provider. Sessions are signed but there is no password, no expiry policy and no revocation. Not suitable for any deployment holding real firefighter data.";

  private readonly secret: string;

  constructor(secret = process.env.VALORIS_DEV_SESSION_SECRET ?? "valoris-development-only") {
    this.secret = secret;
  }

  /** Mint a signed session value. Used by the development sign-in route. */
  issue(actor: Actor): string {
    const payload = Buffer.from(JSON.stringify(actor)).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  async authenticate(request: Request): Promise<AuthResult> {
    const cookie = request.headers.get("cookie") ?? "";
    const match = new RegExp(`${DEV_SESSION_COOKIE}=([^;]+)`).exec(cookie);
    if (match === null) {
      return { authenticated: false, reason: "No session. Sign in at /dev-signin." };
    }

    const raw = decodeURIComponent(match[1] as string);
    const [payload, signature] = raw.split(".");
    if (payload === undefined || signature === undefined) {
      return { authenticated: false, reason: "Malformed session." };
    }

    // Constant-time compare: a fast-fail comparison leaks the signature one
    // byte at a time to anyone willing to measure.
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return { authenticated: false, reason: "Session signature does not verify." };
    }

    try {
      const actor = JSON.parse(Buffer.from(payload, "base64url").toString()) as Actor;
      if (!ROLES.includes(actor.role as Role)) {
        return { authenticated: false, reason: `Unknown role "${actor.role}".` };
      }
      if (typeof actor.organisationId !== "string" || actor.organisationId === "") {
        return { authenticated: false, reason: "Session names no organisation." };
      }
      return { authenticated: true, actor };
    } catch {
      return { authenticated: false, reason: "Session payload is not readable." };
    }
  }
}

/**
 * The production slot, deliberately unimplemented.
 *
 * It REFUSES rather than falling back to the development provider. A stub that
 * quietly degrades to "everyone is signed in" is how a system gets breached by
 * its own convenience.
 */
export class UnconfiguredIdentityProvider implements IdentityProvider {
  readonly name = "unconfigured";
  readonly isProductionGrade = false;
  readonly disclosure =
    "No identity provider is configured. Every request is refused. Configure an agency identity provider before deploying anywhere real.";

  async authenticate(): Promise<AuthResult> {
    return {
      authenticated: false,
      reason:
        "No identity provider configured. Valoris ships no SSO client and invents none. " +
        "Set VALORIS_AUTH=dev for local development, or supply a real provider.",
    };
  }
}

let cached: IdentityProvider | null = null;

/**
 * The active provider.
 *
 * Defaults to REFUSING. Development access is opt-in through an environment
 * variable, so an unconfigured deployment is closed rather than open — the
 * failure mode of forgetting to configure this should be "nothing works", not
 * "everything is visible".
 */
export function currentProvider(): IdentityProvider {
  if (cached !== null) return cached;
  cached = process.env.VALORIS_AUTH === "dev"
    ? new DevIdentityProvider()
    : new UnconfiguredIdentityProvider();
  return cached;
}

/** Test seam. */
export function setProvider(provider: IdentityProvider | null): void {
  cached = provider;
}
