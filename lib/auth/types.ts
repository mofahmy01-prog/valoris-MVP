/**
 * Identity and access — the seam, not the implementation.
 *
 * Before this existed there was no authentication of any kind: anyone who could
 * reach the process could read every firefighter's medical conditions, and every
 * actor label was a self-declared string. This does not fix that on its own. It
 * makes the shape of a fix exist, so route handlers can ask "who is this and may
 * they see it" instead of assuming.
 *
 * WHAT THIS IS NOT: a production authentication system. `DevIdentityProvider`
 * is for local development and says so loudly. A real deployment must supply a
 * real provider — an agency SSO, most likely — and until it does,
 * `UnconfiguredIdentityProvider` refuses rather than falling through to the dev
 * one. A stub that quietly degrades to "everyone is an admin" is how systems get
 * breached.
 *
 * ROLES ARE ABOUT WHAT SOMEONE MAY SEE, not what they may click.
 *
 * The distinction that matters here is between operational need and clinical
 * detail. An incident commander needs to know that a firefighter is in trouble
 * and roughly why — heat, exertion, air. They do not automatically need to know
 * that person's diagnosis, and in most services they are not entitled to it.
 * `MEDICAL_DETAIL` is therefore separated from `OPERATIONAL_PICTURE` at the
 * permission level rather than by convention in a template.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export const ROLES = [
  /** Runs the incident. Sees bands, drivers and advice — not diagnoses. */
  "commander",
  /** Occupational health. Sees the clinical detail behind a band. */
  "clinician",
  /** Configures the system. Sees no individual's physiology by default. */
  "administrator",
  /** Read-only, de-identified. For research and demonstration. */
  "observer",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  /** Bands, scores, drivers, positions — what running an incident requires. */
  "OPERATIONAL_PICTURE",
  /** Conditions, respiratory risk, glucose, the clinical why behind a band. */
  "MEDICAL_DETAIL",
  /** Record what actually happened at incident close. */
  "RECORD_OUTCOME",
  /** Accept, reject or override advice. */
  "ACT_ON_RECOMMENDATION",
  /** Change thresholds. Separated because it changes everyone's scores. */
  "EDIT_CONFIGURATION",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Who may do what.
 *
 * A commander deliberately does NOT hold MEDICAL_DETAIL. That is the whole
 * point of separating the two: the operational picture is what they need, and
 * a diagnosis is not automatically theirs to see. Any service that decides
 * otherwise can grant it explicitly, which is a decision with a record rather
 * than a default nobody chose.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  commander: ["OPERATIONAL_PICTURE", "RECORD_OUTCOME", "ACT_ON_RECOMMENDATION"],
  clinician: ["OPERATIONAL_PICTURE", "MEDICAL_DETAIL", "RECORD_OUTCOME"],
  administrator: ["EDIT_CONFIGURATION"],
  observer: [],
};

export type Actor = {
  /** Stable id. What the audit log should record, not a typed-in name. */
  id: string;
  displayName: string;
  role: Role;
  /** Tenancy. Every query touching incident data must be scoped by this. */
  organisationId: string;
};

export function can(actor: Actor, permission: Permission): boolean {
  return ROLE_PERMISSIONS[actor.role].includes(permission);
}

export type AuthResult =
  | { authenticated: true; actor: Actor }
  | { authenticated: false; reason: string };

export interface IdentityProvider {
  readonly name: string;
  /** False for anything that must not be trusted in a real deployment. */
  readonly isProductionGrade: boolean;
  /** Shown wherever this provider's decisions are relied on. */
  readonly disclosure: string;
  /** Identify the caller from a request, or say why not. */
  authenticate(request: Request): Promise<AuthResult>;
}
