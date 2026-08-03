-- Migration number: 0002 	 2026-08-03T01:38:06.561Z
CREATE UNIQUE INDEX idx_clientes_estudio_dni
ON clientes(estudio_id, dni)
WHERE dni IS NOT NULL;