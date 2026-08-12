-- ---------------------------------------------------------------------------
-- Restore the append-only guards.
--
-- WHY THIS MIGRATION EXISTS. Prisma implements "add a column" on SQLite by
-- rebuilding the table: CREATE TABLE new_Observation, copy rows, DROP TABLE
-- Observation, RENAME. SQLite drops every trigger attached to a dropped table,
-- so the two Observation append-only triggers created in the init migration
-- were silently removed by 20260812205835_position_freshness and again by
-- 20260812212449_derived_physiology.
--
-- The append-only guarantee on the observation record — the raw evidence behind
-- every stored risk assessment — was therefore unenforced at the database level
-- between those migrations and this one. Application code never issued an
-- UPDATE or DELETE, so no data is known to have changed, but the guard was
-- absent and that is not acceptable for an audit trail.
--
-- Detected by scripts/verify-m2.ts, which asserts each trigger exists by name.
--
-- ANY FUTURE MIGRATION THAT TOUCHES Observation OR AuditEvent MUST re-apply
-- these. Run `npm run db:guards` after migrating, and `npm run verify:m2` to
-- confirm. All statements below are idempotent so this file can be replayed.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "Observation_no_update";
DROP TRIGGER IF EXISTS "Observation_no_delete";
DROP TRIGGER IF EXISTS "AuditEvent_no_update";
DROP TRIGGER IF EXISTS "AuditEvent_no_delete";
DROP TRIGGER IF EXISTS "CommanderAction_reason_required_insert";

CREATE TRIGGER "Observation_no_update"
BEFORE UPDATE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER "Observation_no_delete"
BEFORE DELETE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: DELETE is not permitted');
END;

CREATE TRIGGER "AuditEvent_no_update"
BEFORE UPDATE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER "AuditEvent_no_delete"
BEFORE DELETE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: DELETE is not permitted');
END;

CREATE TRIGGER "CommanderAction_reason_required_insert"
BEFORE INSERT ON "CommanderAction"
WHEN NEW."action" IN ('reject', 'override')
     AND (NEW."reasonText" IS NULL OR TRIM(NEW."reasonText") = '')
BEGIN
  SELECT RAISE(ABORT, 'A reject or override requires a non-empty reason');
END;
