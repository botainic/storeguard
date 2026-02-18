-- Unify EventLog + ChangeEvent into single event pipeline
-- EventLog is no longer referenced anywhere in the codebase.
-- All audit/activity logging already uses ChangeEvent with topic, diff, author fields.

-- Step 1: Make webhookId nullable on ChangeEvent (activity-only events don't need dedup)
ALTER TABLE "ChangeEvent" ALTER COLUMN "webhookId" DROP NOT NULL;

-- Step 2: Drop EventLog table and its indexes
DROP TABLE IF EXISTS "EventLog";
