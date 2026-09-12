-- ============================================================
-- Migración 0006: adjuntos múltiples por actuación (vista MEV)
--
-- actuaciones.documento_id (0001_esquema_inicial) es 1 a 1 y quedó corto:
-- una resolución con su cédula de notificación, o un escrito con anexos,
-- son casos reales de más de un archivo por movimiento procesal. Se agrega
-- una tabla puente N a N sin tocar la columna vieja (queda deprecada, sin
-- uso en código nuevo, para no romper nada que ya la referencie).
-- ============================================================

CREATE TABLE actuacion_documentos (
  actuacion_id  TEXT NOT NULL REFERENCES actuaciones(id),
  documento_id  TEXT NOT NULL REFERENCES documentos(id),
  creado_en     INTEGER NOT NULL,
  PRIMARY KEY (actuacion_id, documento_id)
);
CREATE INDEX idx_actuacion_documentos_documento ON actuacion_documentos(documento_id);
