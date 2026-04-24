import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[WARNING] Supabase URL or Service Key missing. Supabase client will not work properly.');
}

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseServiceKey || 'dummy'
);
