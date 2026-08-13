/**
 * Zod schemas for every request body the API accepts.
 *
 * The reason requirement for reject and override lives here and is enforced
 * server-side. `.trim().min(1)` rejects an empty string AND a whitespace-only
 * string. The database has a matching trigger, so neither a UI bug nor a direct
 * Prisma call can record one without a reason.
 */

import { z } from "zod";

import {
  COMMANDER_ACTIONS,
  ESCAPE_ROUTE_STATUSES,
  FIRE_PROVIDER_KEYS,
  OBSERVATION_SOURCES,
} from "@/lib/db/enums";

/** A reason that is present and not just whitespace. */
export const reasonSchema = z
  .string({ required_error: "A reason is required", invalid_type_error: "A reason is required" })
  .trim()
  .min(1, "A reason is required and cannot be empty or whitespace only")
  .max(2000, "A reason must be 2000 characters or fewer");

export const actorLabelSchema = z.string().trim().min(1).max(120).default("commander");

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export const createIncidentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  organisationId: z.string().uuid().optional(),
  scenarioKey: z.string().trim().min(1).max(80).default("baseline_wildfire"),
  fireProviderKey: z.enum(FIRE_PROVIDER_KEYS).default("geometric_spread_placeholder"),
  centroidLat: z.number().min(-90).max(90),
  centroidLng: z.number().min(-180).max(180),
  /** Callsigns to deploy. Omitted means every profile in the organisation. */
  callsigns: z.array(z.string().trim().min(1)).optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

export const startIncidentSchema = z.object({
  actorLabel: actorLabelSchema,
});

export const stopIncidentSchema = z.object({
  actorLabel: actorLabelSchema,
  reason: z.string().trim().max(2000).optional(),
});

/* -------------------------------------------------------------------------- */
/* Observations                                                                */
/* -------------------------------------------------------------------------- */

/** A reading plus the UTC instant it was taken. Absent means no reading. */
const channelSchema = z
  .object({
    value: z.number().finite().nullable(),
    updatedAtUtc: z.coerce.date().nullable().optional(),
  })
  .strict();

const nullableNumber = z.number().finite().nullable();

export const observationSchema = z
  .object({
    callsign: z.string().trim().min(1),
    recordedAtUtc: z.coerce.date(),
    source: z.enum(OBSERVATION_SOURCES),

    vitals: z
      .object({
        hrBpm: channelSchema.optional(),
        spo2Pct: channelSchema.optional(),
        coreTempC: channelSchema.optional(),
        respRatePerMin: channelSchema.optional(),
        fatiguePct: channelSchema.optional(),
        hydrationPct: channelSchema.optional(),
        fallDetected: z.boolean().default(false),
      })
      .strict(),

    environment: z
      .object({
        ambientTempC: channelSchema.optional(),
        humidityPct: channelSchema.optional(),
        coPpm: channelSchema.optional(),
        pm25UgM3: channelSchema.optional(),
        windSpeedMs: channelSchema.optional(),
        windDirDeg: channelSchema.optional(),

        /**
         * A raw two-channel PurpleAir reading. When present, the EPA US-wide
         * correction (extended for wildfire smoke) is applied server-side and
         * the CORRECTED value is what the risk engine consumes. Raw values are
         * stored alongside and never overwritten.
         *
         * Supplying this takes precedence over `pm25UgM3`: a caller must not be
         * able to hand in a pre-corrected number and a raw one that disagree.
         */
        purpleAir: z
          .object({
            /** pm2.5_cf_1 channel A. The atm channel is not accepted. */
            pm25_cf_1_a: z.number().finite(),
            /** pm2.5_cf_1 channel B. */
            pm25_cf_1_b: z.number().finite(),
            humidityPct: z.number().finite(),
            temperatureC: z.number().finite(),
            sensorId: z.string().trim().min(1).max(120),
            updatedAtUtc: z.coerce.date().nullable().optional(),
            /**
             * Only a caller that actually pulled this from the PurpleAir network
             * may set this true. It is what promotes the reading to Tier A —
             * real environmental measurement — so it defaults to false and
             * simulated data stays Tier C.
             */
            isRealSensorData: z.boolean().default(false),
          })
          .strict()
          .optional(),
      })
      .strict(),

    position: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        distanceToFireFrontM: nullableNumber.optional(),
        distanceToSafeZoneM: nullableNumber.optional(),
        escapeRouteStatus: z.enum(ESCAPE_ROUTE_STATUSES),
        scbaPressurePct: nullableNumber.optional(),
        scbaOnAir: z.boolean().default(true),
        /** Drives the heat-balance clothing terms. Defaults to worn. */
        wearingPpe: z.boolean().default(true),
        timeOnTaskMin: z.number().finite().min(0),
        manualMaydayActive: z.boolean().default(false),

        // Per-channel freshness. Each defaults to the observation time when the
        // caller omits it, matching how vitals and environment channels behave.
        // A simulated sensor failure works by simply not advancing one of these.
        fixUpdatedAtUtc: z.coerce.date().nullable().optional(),
        distanceToFireFrontUpdatedAtUtc: z.coerce.date().nullable().optional(),
        distanceToSafeZoneUpdatedAtUtc: z.coerce.date().nullable().optional(),
        escapeRouteUpdatedAtUtc: z.coerce.date().nullable().optional(),
        scbaPressureUpdatedAtUtc: z.coerce.date().nullable().optional(),
      })
      .strict(),
  })
  .strict();
export type ObservationInput = z.infer<typeof observationSchema>;

export const postObservationsSchema = z.object({
  observations: z.array(observationSchema).min(1).max(500),
  actorLabel: actorLabelSchema,
});

/* -------------------------------------------------------------------------- */
/* Commander actions on recommendations                                        */
/* -------------------------------------------------------------------------- */

export const acknowledgeSchema = z.object({
  actorLabel: actorLabelSchema,
  note: z.string().trim().max(2000).optional(),
});

export const acceptSchema = z.object({
  actorLabel: actorLabelSchema,
  note: z.string().trim().max(2000).optional(),
});

/** Reason is mandatory. Empty or whitespace-only is a 400. */
export const rejectSchema = z.object({
  actorLabel: actorLabelSchema,
  reason: reasonSchema,
});

/** Reason is mandatory. Empty or whitespace-only is a 400. */
export const overrideSchema = z.object({
  actorLabel: actorLabelSchema,
  reason: reasonSchema,
  replacementAction: z.string().trim().max(500).optional(),
});

export const commanderActionSchema = z
  .object({
    action: z.enum(COMMANDER_ACTIONS),
    actorLabel: actorLabelSchema,
    reason: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action !== "reject" && value.action !== "override") return;
    const parsed = reasonSchema.safeParse(value.reason);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: `A ${value.action} requires a non-empty reason`,
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Query parameters                                                            */
/* -------------------------------------------------------------------------- */

export const auditQuerySchema = z.object({
  incidentId: z.string().uuid().optional(),
  eventType: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
