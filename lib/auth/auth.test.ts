/**
 * Access control invariants.
 *
 * Two failure modes matter more than any other here. A system that defaults to
 * open when misconfigured, and a session whose role can be edited by the person
 * holding it. Both look fine in normal use and are catastrophic in the one case
 * that counts.
 */

import { describe, expect, it } from "vitest";

import {
  can,
  DevIdentityProvider,
  ROLE_PERMISSIONS,
  UnconfiguredIdentityProvider,
  DEV_SESSION_COOKIE,
  type Actor,
} from "./index";

const ACTOR: Actor = {
  id: "u-1",
  displayName: "IC Bell",
  role: "commander",
  organisationId: "org-1",
};

function requestWithSession(value: string): Request {
  return new Request("http://localhost/x", {
    headers: { cookie: `${DEV_SESSION_COOKIE}=${encodeURIComponent(value)}` },
  });
}

describe("access control — closed by default", () => {
  it("refuses everything when no provider is configured", async () => {
    const result = await new UnconfiguredIdentityProvider().authenticate();
    expect(result.authenticated).toBe(false);
    if (result.authenticated) return;
    // Forgetting to configure auth must mean "nothing works", never
    // "everything is visible".
    expect(result.reason).toMatch(/No identity provider configured/i);
  });

  it("refuses a request with no session", async () => {
    const result = await new DevIdentityProvider("s").authenticate(
      new Request("http://localhost/x"),
    );
    expect(result.authenticated).toBe(false);
  });

  it("never claims to be production grade", () => {
    expect(new DevIdentityProvider("s").isProductionGrade).toBe(false);
    expect(new UnconfiguredIdentityProvider().isProductionGrade).toBe(false);
  });
});

describe("access control — the session cannot be edited by its holder", () => {
  it("accepts a session it signed", async () => {
    const provider = new DevIdentityProvider("secret");
    const result = await provider.authenticate(requestWithSession(provider.issue(ACTOR)));
    expect(result.authenticated).toBe(true);
    if (!result.authenticated) return;
    expect(result.actor.role).toBe("commander");
    expect(result.actor.organisationId).toBe("org-1");
  });

  it("rejects a session whose ROLE has been escalated", async () => {
    const provider = new DevIdentityProvider("secret");
    const [, signature] = provider.issue(ACTOR).split(".");

    // Re-encode the payload as a clinician, keeping the original signature.
    const forged = Buffer.from(
      JSON.stringify({ ...ACTOR, role: "clinician" }),
    ).toString("base64url");

    const result = await provider.authenticate(
      requestWithSession(`${forged}.${signature ?? ""}`),
    );
    expect(result.authenticated).toBe(false);
    if (result.authenticated) return;
    expect(result.reason).toMatch(/signature does not verify/i);
  });

  it("rejects a session whose ORGANISATION has been swapped", async () => {
    const provider = new DevIdentityProvider("secret");
    const [, signature] = provider.issue(ACTOR).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...ACTOR, organisationId: "someone-elses-brigade" }),
    ).toString("base64url");

    const result = await provider.authenticate(
      requestWithSession(`${forged}.${signature ?? ""}`),
    );
    expect(result.authenticated).toBe(false);
  });

  it("rejects a session signed with a different secret", async () => {
    const issued = new DevIdentityProvider("secret-a").issue(ACTOR);
    const result = await new DevIdentityProvider("secret-b").authenticate(
      requestWithSession(issued),
    );
    expect(result.authenticated).toBe(false);
  });

  it("rejects a session naming an unknown role", async () => {
    const provider = new DevIdentityProvider("secret");
    const issued = provider.issue({ ...ACTOR, role: "superuser" as Actor["role"] });
    const result = await provider.authenticate(requestWithSession(issued));
    expect(result.authenticated).toBe(false);
    if (result.authenticated) return;
    expect(result.reason).toMatch(/Unknown role/i);
  });
});

describe("access control — a commander is not entitled to a diagnosis", () => {
  it("gives a commander the operational picture but NOT medical detail", () => {
    const commander: Actor = { ...ACTOR, role: "commander" };
    expect(can(commander, "OPERATIONAL_PICTURE")).toBe(true);
    // The separation this whole model exists for. A commander needs to know
    // someone is in trouble; they are not automatically entitled to why.
    expect(can(commander, "MEDICAL_DETAIL")).toBe(false);
  });

  it("gives a clinician medical detail", () => {
    expect(can({ ...ACTOR, role: "clinician" }, "MEDICAL_DETAIL")).toBe(true);
  });

  it("does not let an administrator read individual physiology by default", () => {
    const admin: Actor = { ...ACTOR, role: "administrator" };
    expect(can(admin, "MEDICAL_DETAIL")).toBe(false);
    expect(can(admin, "OPERATIONAL_PICTURE")).toBe(false);
    // Configuring the system is a different job from watching people.
    expect(can(admin, "EDIT_CONFIGURATION")).toBe(true);
  });

  it("gives an observer nothing", () => {
    expect(ROLE_PERMISSIONS.observer).toEqual([]);
  });

  it("does not let a commander change thresholds", () => {
    // Editing configuration changes everyone's scores at once, so it is kept
    // away from the person under time pressure during an incident.
    expect(can({ ...ACTOR, role: "commander" }, "EDIT_CONFIGURATION")).toBe(false);
  });
});
