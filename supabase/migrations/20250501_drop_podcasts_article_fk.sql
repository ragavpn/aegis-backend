-- Migration: Allow daily digest podcasts to have no article_id
-- The podcasts table previously required article_id to reference a valid article.
-- Daily digest podcasts span multiple articles so they use NULL as article_id.
--
-- Changes:
--   1. Drop the FK constraint on podcasts.article_id
--   2. Make article_id nullable

-- Step 1: Drop the FK constraint
ALTER TABLE podcasts DROP CONSTRAINT IF EXISTS podcasts_article_id_fkey;

-- Step 2: Make article_id nullable (in case it was NOT NULL)
ALTER TABLE podcasts ALTER COLUMN article_id DROP NOT NULL;

-- Optional index so daily digest lookups (article_id IS NULL) are fast
CREATE INDEX IF NOT EXISTS podcasts_daily_digest_idx
  ON podcasts (created_at DESC)
  WHERE article_id IS NULL;
