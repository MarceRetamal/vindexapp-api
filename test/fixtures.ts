// Helpers compartidos por los tests de integración. Toda tabla del esquema cuelga
// de estudio_id (aislamiento multi-estudio) — casi ningún test de ruta puede armarse
// sin insertar primero un estudio.
import type { D1Database } from '@cloudflare/workers-types';

export async function crearEstudioDePrueba(db: D1Database): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO estudios (id, nombre, creado_en, activo) VALUES (?, ?, ?, 1)')
    .bind(id, 'Estudio de prueba', Date.now())
    .run();
  return id;
}
