-- =====================================================
-- Fix #3: Add processing_status + processing_error to ai_emails
-- Enables tracking the pipeline stage for each email
-- =====================================================

-- processing_status tracks where each email is in the pipeline
ALTER TABLE ai_emails
  ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED','CLASSIFIED','SAVED','ATTACHMENTS_UPLOADED','ROUTED','DONE','FAILED'));

-- processing_error stores the last error message if status = FAILED
ALTER TABLE ai_emails
  ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Index for quick lookups of failed emails
CREATE INDEX IF NOT EXISTS idx_ai_emails_processing_status ON ai_emails(processing_status);

COMMENT ON COLUMN ai_emails.processing_status IS 'Pipeline stage: RECEIVED → CLASSIFIED → SAVED → ATTACHMENTS_UPLOADED → ROUTED → DONE | FAILED';
COMMENT ON COLUMN ai_emails.processing_error IS 'Last error message if processing_status = FAILED';
