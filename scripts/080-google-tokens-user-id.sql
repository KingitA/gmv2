-- =====================================================
-- Add user_id to google_tokens for per-user Gmail linking
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Add user_id column
ALTER TABLE google_tokens ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Create index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_google_tokens_user_id ON google_tokens(user_id);

-- Change unique constraint: same Gmail can be linked by different users
ALTER TABLE google_tokens DROP CONSTRAINT IF EXISTS google_tokens_email_key;
ALTER TABLE google_tokens ADD CONSTRAINT google_tokens_user_email_key UNIQUE(user_id, email);
