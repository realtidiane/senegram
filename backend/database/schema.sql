-- =====================================================
--  SENEGRAM - Schema PostgreSQL
--  Base: realtidiane/senegram (conversion MySQL)
--  Corrections integrees depuis fsarr10/senegram:
--    - Colonne users.is_online (presence rapide)
--    - Index online+last_seen
--    - Colonnes messages.sent_at, delivered_at, read_at, is_pinned, pinned_by, pinned_at
--    - Index messages (conv_id DESC, status, pinned, sender, FULLTEXT content)
--    - Table push_subscriptions (notifications Web Push)
--  Date integration: 2026-09-09
-- =====================================================

DROP DATABASE IF EXISTS senegram;
CREATE DATABASE senegram ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;
\c senegram

-- Extensions utiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- (FULLTEXT n'existe pas en PostgreSQL natif, on utilise pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- Utilisateurs
-- =====================================================
CREATE TYPE user_status AS ENUM ('online','offline','away','busy');

CREATE TABLE users (
  id               BIGSERIAL PRIMARY KEY,
  username         VARCHAR(50)  NOT NULL UNIQUE,
  email            VARCHAR(150) NOT NULL UNIQUE,
  phone            VARCHAR(30)  DEFAULT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  display_name     VARCHAR(100) NOT NULL,
  bio              VARCHAR(255) DEFAULT NULL,
  avatar_url       VARCHAR(500) DEFAULT NULL,
  status           user_status NOT NULL DEFAULT 'offline',
  is_online        BOOLEAN NOT NULL DEFAULT FALSE,  -- CORRECTION: presence rapide
  last_seen        TIMESTAMP DEFAULT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
-- CORRECTION: index optimise pour la liste des utilisateurs online
CREATE INDEX idx_users_online_last_seen ON users(is_online, last_seen);

-- =====================================================
-- Contacts
-- =====================================================
CREATE TABLE contacts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias           VARCHAR(100) DEFAULT NULL,
  is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uniq_contact UNIQUE (user_id, contact_user_id)
);

-- =====================================================
-- Conversations
-- =====================================================
CREATE TYPE conversation_type AS ENUM ('private','group');

CREATE TABLE conversations (
  id          BIGSERIAL PRIMARY KEY,
  type        conversation_type NOT NULL,
  name        VARCHAR(150) DEFAULT NULL,
  description VARCHAR(500) DEFAULT NULL,
  avatar_url  VARCHAR(500) DEFAULT NULL,
  created_by  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- Membres
-- =====================================================
CREATE TYPE member_role AS ENUM ('owner','admin','member');

CREATE TABLE conversation_members (
  id                    BIGSERIAL PRIMARY KEY,
  conversation_id       BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                  member_role NOT NULL DEFAULT 'member',
  joined_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_message_id  BIGINT DEFAULT NULL,
  is_muted              BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uniq_member UNIQUE (conversation_id, user_id)
);

-- =====================================================
-- Messages
-- CORRECTION: colonnes sent_at/delivered_at/read_at/is_pinned pour le
-- lifecycle complet d'un message (style WhatsApp/Telegram)
-- =====================================================
CREATE TYPE message_type AS ENUM ('text','image','video','audio','file','system','call');

CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT,
  type            message_type NOT NULL DEFAULT 'text',
  reply_to_id     BIGINT DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL,
  is_edited       BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  -- CORRECTIONS du cycle de vie
  sent_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at    TIMESTAMP DEFAULT NULL,
  read_at         TIMESTAMP DEFAULT NULL,
  is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_by       BIGINT DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  pinned_at       TIMESTAMP DEFAULT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index de base
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

-- CORRECTIONS: index de performance
CREATE INDEX idx_messages_conv_id_desc ON messages(conversation_id, id DESC);
CREATE INDEX idx_messages_status ON messages(conversation_id, sender_id, delivered_at, read_at);
CREATE INDEX idx_messages_pinned ON messages(conversation_id, is_pinned, pinned_at);
CREATE INDEX idx_messages_sender ON messages(sender_id, conversation_id);

-- Recherche FULLTEXT (equivalent MySQL FULLTEXT)
-- PostgreSQL utilise pg_trgm + index GIN pour la recherche fulltext
CREATE INDEX idx_messages_content_trgm ON messages USING GIN (content gin_trgm_ops);

-- =====================================================
-- Attachments
-- =====================================================
CREATE TABLE attachments (
  id          BIGSERIAL PRIMARY KEY,
  message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url         VARCHAR(500) NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  file_size   BIGINT DEFAULT 0,
  mime_type   VARCHAR(120) NOT NULL,
  duration    INT DEFAULT NULL,
  width       INT DEFAULT NULL,
  height      INT DEFAULT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attachments_message ON attachments(message_id);

-- =====================================================
-- Message reads (read-receipts)
-- =====================================================
CREATE TABLE message_reads (
  id          BIGSERIAL PRIMARY KEY,
  message_id  BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uniq_read UNIQUE (message_id, user_id)
);

-- =====================================================
-- Calls
-- =====================================================
CREATE TYPE call_type AS ENUM ('audio','video');
CREATE TYPE call_status AS ENUM ('ringing','ongoing','ended','missed','rejected');

CREATE TABLE calls (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             call_type NOT NULL,
  status           call_status NOT NULL DEFAULT 'ringing',
  started_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at         TIMESTAMP DEFAULT NULL,
  duration         INT DEFAULT 0
);

CREATE INDEX idx_calls_conv ON calls(conversation_id);

-- =====================================================
-- Call participants
-- =====================================================
CREATE TABLE call_participants (
  id        BIGSERIAL PRIMARY KEY,
  call_id   BIGINT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT NULL,
  left_at   TIMESTAMP DEFAULT NULL,
  CONSTRAINT uniq_participant UNIQUE (call_id, user_id)
);

-- =====================================================
-- Push Subscriptions (CORRECTION: notifications Web Push)
-- =====================================================
CREATE TABLE push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uniq_push_endpoint UNIQUE (endpoint)
);

CREATE INDEX idx_push_user ON push_subscriptions(user_id);

-- =====================================================
-- Trigger updated_at (remplace MySQL ON UPDATE CURRENT_TIMESTAMP)
-- =====================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_conversations BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_messages BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_push_subscriptions BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =====================================================
-- Message reactions
-- =====================================================
CREATE TABLE message_reactions (
  id         BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uniq_reaction UNIQUE (message_id, user_id)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user ON message_reactions(user_id);

-- =====================================================
-- Donnees de demo (mot de passe = "password" bcrypt hash)
-- =====================================================
INSERT INTO users (username, email, password_hash, display_name, bio, avatar_url) VALUES
('aminata', 'aminata@senegram.sn', '$2a$10$R0mZqZk8zHjAq.WqjCw/8uQc5v5wY6qv3Q8QyvxJ2YkQXq5Z8rU7K', 'Aminata Diop', 'Teranga Dakar', 'https://i.pravatar.cc/150?img=47'),
('moussa',  'moussa@senegram.sn',  '$2a$10$R0mZqZk8zHjAq.WqjCw/8uQc5v5wY6qv3Q8QyvxJ2YkQXq5Z8rU7K', 'Moussa Sarr',  'Thies',           'https://i.pravatar.cc/150?img=12'),
('fatou',   'fatou@senegram.sn',   '$2a$10$R0mZqZk8zHjAq.WqjCw/8uQc5v5wY6qv3Q8QyvxJ2YkQXq5Z8rU7K', 'Fatou Ndiaye', 'Saint-Louis',     'https://i.pravatar.cc/150?img=32');
