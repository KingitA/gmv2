-- =====================================================
-- AI Brain Tables - Phase 1
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Google OAuth tokens storage
CREATE TABLE IF NOT EXISTS google_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expiry_date BIGINT,
  scopes TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Conversations (chat sessions)
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  source TEXT NOT NULL CHECK (source IN ('chat', 'gmail', 'whatsapp')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Messages (individual messages within a conversation)
CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);

-- Synced Gmail emails
CREATE TABLE IF NOT EXISTS ai_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_id TEXT NOT NULL UNIQUE,
  thread_id TEXT,
  from_email TEXT,
  from_name TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  received_at TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT FALSE,
  is_processed BOOLEAN DEFAULT FALSE,
  labels TEXT[],
  classification TEXT CHECK (classification IN (
    'pedido', 'orden_compra', 'pago', 'cambio_precio',
    'reclamo', 'consulta', 'spam', 'otro'
  )),
  entity_type TEXT CHECK (entity_type IN ('cliente', 'proveedor', 'desconocido')),
  entity_name TEXT,
  confidence REAL,
  ai_summary TEXT,
  processing_status TEXT DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','CLASSIFIED','SAVED','ATTACHMENTS_UPLOADED','ROUTED','DONE','FAILED')),
  processing_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_emails_gmail_id ON ai_emails(gmail_id);
CREATE INDEX IF NOT EXISTS idx_ai_emails_classification ON ai_emails(classification);
CREATE INDEX IF NOT EXISTS idx_ai_emails_processed ON ai_emails(is_processed);

-- Email attachments
CREATE TABLE IF NOT EXISTS ai_email_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID REFERENCES ai_emails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  storage_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agenda events
CREATE TABLE IF NOT EXISTS ai_agenda_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'vencimiento_proveedor', 'pedido_preparar', 'mercaderia_recibir',
    'cambio_precio', 'pago_imputar', 'reclamo_resolver',
    'tarea_general', 'recordatorio'
  )),
  priority TEXT DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta', 'urgente')),
  status TEXT DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_progreso', 'completada', 'cancelada')),
  due_date DATE,
  due_time TIME,
  source TEXT CHECK (source IN ('gmail', 'whatsapp', 'chat', 'sistema')),
  source_ref_id UUID,
  related_entity_type TEXT,
  related_entity_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_agenda_due_date ON ai_agenda_events(due_date);
CREATE INDEX IF NOT EXISTS idx_ai_agenda_status ON ai_agenda_events(status);
CREATE INDEX IF NOT EXISTS idx_ai_agenda_type ON ai_agenda_events(event_type);

-- AI Classifications log (for auditing / learning)
CREATE TABLE IF NOT EXISTS ai_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('gmail', 'whatsapp', 'chat')),
  source_ref_id TEXT,
  raw_content TEXT,
  classification TEXT NOT NULL,
  entity_type TEXT,
  entity_name TEXT,
  confidence REAL,
  extracted_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (optional, depends on your security model)
ALTER TABLE google_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agenda_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_classifications ENABLE ROW LEVEL SECURITY;

-- Service role bypass policies (so our backend can read/write)
CREATE POLICY "Service role full access" ON google_tokens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ai_conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ai_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ai_emails FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ai_email_attachments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ai_agenda_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ai_classifications FOR ALL USING (true) WITH CHECK (true);
