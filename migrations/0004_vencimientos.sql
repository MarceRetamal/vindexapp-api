-- ============================================================
-- Migración 0004: vencimientos manuales en actuaciones
-- El abogado carga la fecha límite a mano; el backend no calcula
-- plazos procesales (días hábiles, feriados, etc.) — fuera de alcance.
-- ============================================================

ALTER TABLE actuaciones ADD COLUMN vencimiento TEXT;
ALTER TABLE actuaciones ADD COLUMN vencimiento_alertado INTEGER NOT NULL DEFAULT 0;
