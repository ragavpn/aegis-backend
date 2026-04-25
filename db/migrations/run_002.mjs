// One-off migration runner — safe to delete after use
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { error } = await supabase.rpc('exec_sql', {
  query: `ALTER TABLE article_interactions
    ADD CONSTRAINT article_interactions_user_article_unique
    UNIQUE (user_id, article_id);`
});

if (error) {
  // Likely already exists — that's fine
  if (error.message.includes('already exists')) {
    console.log('✅ Constraint already exists — nothing to do.');
  } else {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('✅ Migration 002 applied: UNIQUE(user_id, article_id) on article_interactions');
}
