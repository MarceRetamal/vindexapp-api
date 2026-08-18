-- ============================================================
-- Migración 0005: conexión OAuth con Google Calendar
-- Solo el flujo de conexión (guarda tokens); el motor de
-- sincronización de eventos es una tarea posterior.
-- ============================================================

CREATE TABLE google_tokens (
  usuario_id TEXT PRIMARY KEY REFERENCES usuarios(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expira_en INTEGER NOT NULL,
  google_calendar_id TEXT,
  conectado_en INTEGER NOT NULL
);

ALTER TABLE audiencias ADD COLUMN actualizado_en INTEGER;
ALTER TABLE audiencias ADD COLUMN google_event_id TEXT;
