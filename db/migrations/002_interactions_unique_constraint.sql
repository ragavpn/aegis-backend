-- Migration 002: Add unique constraint to article_interactions
-- Required for upsert (ON CONFLICT user_id, article_id) to work correctly.
-- Run this once in the Supabase SQL Editor.

ALTER TABLE article_interactions
  ADD CONSTRAINT article_interactions_user_article_unique
  UNIQUE (user_id, article_id);
