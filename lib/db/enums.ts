/**
 * SQLite has no enum type, so these named unions are the single source of truth
 * for every constrained string column. Zod schemas derive from them, so a value
 * the database can hold and the API rejects cannot drift apart.
 */

export const INCIDENT_STATUSES = ["created", "running", "stopped"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const OBSERVATION_SOURCES = [
  "simulated_wearable",
  "simulated_scba",
  "simulated_atmos",
  "simulated_position",
  "commander",
] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const ESCAPE_ROUTE_STATUSES = ["clear", "degraded", "blocked"] as const;
export type EscapeRouteStatus = (typeof ESCAPE_ROUTE_STATUSES)[number];

export const RECOMMENDATION_TYPES = [
  "monitor",
  "rotate",
  "withdraw",
  "preposition_relief",
  "restore_scba",
  "check_sensor",
  "medical_review",
  "insufficient_data",
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_STATUSES = [
  "open",
  "acknowledged",
  "accepted",
  "rejected",
  "overridden",
  "expired",
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const COMMANDER_ACTIONS = [
  "acknowledge",
  "accept",
  "reject",
  "override",
] as const;
export type CommanderActionKind = (typeof COMMANDER_ACTIONS)[number];

/** Actions that may not be recorded without a reason. */
export const ACTIONS_REQUIRING_REASON: readonly CommanderActionKind[] = [
  "reject",
  "override",
];

export const AUDIT_EVENT_TYPES = [
  "incident_created",
  "incident_started",
  "incident_stopped",
  "observation_ingested",
  "risk_assessed",
  "band_transition",
  "recommendation_created",
  "recommendation_acknowledged",
  "recommendation_accepted",
  "recommendation_rejected",
  "recommendation_overridden",
  "recommendation_expired",
  "sensor_toggled",
  "scenario_injected",
  "fire_front_provider_selected",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const FIRE_PROVIDER_KEYS = [
  "geometric_spread_placeholder",
  "farsite_adapter",
  "historical_perimeter",
] as const;
