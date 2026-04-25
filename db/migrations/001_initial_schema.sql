-- Users managed by Supabase Auth (auth.users table)

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  modules TEXT[] NOT NULL DEFAULT '{}',
  notification_flash BOOLEAN DEFAULT TRUE,
  notification_priority BOOLEAN DEFAULT TRUE,
  notification_routine BOOLEAN DEFAULT FALSE,
  dnd_start TIME,
  dnd_end TIME,
  tts_speed FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  summary TEXT NOT NULL,
  modules TEXT[] NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]',
  sweep_id TEXT,
  graph_context_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE article_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  read_duration_seconds INTEGER DEFAULT 0,
  scroll_depth_percent INTEGER DEFAULT 0,
  liked BOOLEAN,
  bookmarked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('FLASH', 'PRIORITY', 'ROUTINE')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  article_id UUID REFERENCES articles(id),
  read BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE podcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id),
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE podcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_data" ON user_preferences USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON articles USING (auth.uid() IS NOT NULL); -- Articles are global, read by authenticated users
CREATE POLICY "own_data" ON article_interactions USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON conversations USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON messages USING (auth.uid() IN (SELECT user_id FROM conversations WHERE id = messages.conversation_id));
CREATE POLICY "own_data" ON notifications USING (auth.uid() = user_id);
CREATE POLICY "own_data" ON podcasts USING (auth.uid() IS NOT NULL); -- Podcasts are global
CREATE POLICY "own_data" ON device_tokens USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_articles_created_at ON articles(created_at DESC);
CREATE INDEX idx_article_interactions_user ON article_interactions(user_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);
