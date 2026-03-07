-- =====================================================
-- Gmail Push Notifications — DB Migration
-- Adds support for historyId-based incremental sync
-- and Pub/Sub watch expiry tracking
-- =====================================================

-- Add history_id to track last processed Gmail history point
ALTER TABLE google_tokens
ADD COLUMN IF NOT EXISTS history_id BIGINT;

-- Add watch_expiry to track when the Pub/Sub watch subscription expires
ALTER TABLE google_tokens
ADD COLUMN IF NOT EXISTS watch_expiry TIMESTAMPTZ;

-- Comment for documentation
COMMENT ON COLUMN google_tokens.history_id IS 'Last processed Gmail historyId for incremental sync';
COMMENT ON COLUMN google_tokens.watch_expiry IS 'Expiry timestamp of the Gmail Pub/Sub watch subscription (max 7 days)';
