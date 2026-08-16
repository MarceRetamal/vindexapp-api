-- ============================================================
-- Migración 0003: tareas (pendientes por expediente)
-- ============================================================

CREATE TABLE tareas (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  expediente_id TEXT NOT NULL REFERENCES expedientes(id),
  titulo        TEXT NOT NULL,
  descripcion   TEXT,
  estado        TEXT NOT NULL DEFAULT 'Pendiente'
                CHECK (estado IN ('Pendiente','En curso','Completada')),
  fecha_limite  TEXT,
  asignado_a    TEXT REFERENCES usuarios(id),
  creado_por    TEXT REFERENCES usuarios(id),
  creado_en     INTEGER NOT NULL,
  completado_en INTEGER
);
CREATE INDEX idx_tareas_expediente ON tareas(expediente_id);
CREATE INDEX idx_tareas_estado     ON tareas(estado);
