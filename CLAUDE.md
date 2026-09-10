# CLAUDE.md

Backend de VINDEX LEGAL App: Cloudflare Worker (Hono) + D1 + R2. Ver `README.md` para contexto de producto.

## Comandos

- `npm run dev` — levanta el Worker local (usa bindings remotos de D1/R2 vía `remote: true`; hace falta `npx wrangler login` la primera vez).
- `npm run typecheck` — `tsc --noEmit`. Correlo antes de dar por terminado cualquier cambio; `strict` + `noUncheckedIndexedAccess` están activos.
- `npm test` — `vitest run` sobre `@cloudflare/vitest-pool-workers`. Primer corrida puede tardar ~30s porque abre una conexión remota a Cloudflare para resolver los bindings de `wrangler.jsonc`, incluso en tests que no los usan.
- `npm run deploy` — despliega a Cloudflare. No lo corras sin que te lo pidan explícitamente.

## Convenciones del codebase

- **Todo en español**: nombres de variables, mensajes de error de la API, comentarios. No mezclar inglés en código nuevo.
- **Un archivo por entidad en `src/rutas/`**, exportando `<entidad>Router` (ej. `clientesRouter`), montado en `src/index.ts` bajo `/api/<entidad>`. Al agregar una entidad nueva, seguí ese patrón exacto en vez de improvisar uno distinto.
- **Sin ORM**: acceso a D1 con SQL crudo vía `c.env.DB.prepare(...).bind(...).first()/.all()/.run()`. No introduzcas un query builder u ORM sin que se discuta antes — es una decisión deliberada del proyecto.
- **`src/tipos.ts` (interfaz `Bindings`) debe reflejar exactamente los bindings de `wrangler.jsonc`** — si agregás un binding en uno, actualizá el otro en el mismo cambio.
- **Errores de API**: `c.json({ error: '...' }, <status>)` con mensajes en español, terminados en punto. 400 (validación), 404 (no encontrado), 409 (conflicto/duplicado), 500 (cae al `app.onError` central en `index.ts`, no repitas ese catch-all en cada ruta).
- **Condiciones de carrera en constraints UNIQUE**: el patrón es chequear existencia antes (mensaje claro) *y* capturar `UNIQUE constraint failed` en el `catch` del `INSERT`/`UPDATE` (ver `src/rutas/clientes.ts`) — las dos capas, no solo una.
- **Migraciones**: archivos numerados secuencialmente en `migrations/` (`000N_descripcion.sql`). Nunca edites una migración ya aplicada; sumá una nueva.

## Autenticación — NO tocar sin confirmar

Cloudflare Access está configurado a nivel de infraestructura (dashboard/zona), no en el código. **Ninguna ruta en `src/rutas/` debe agregar su propio middleware de auth** — todo el tráfico ya pasa por Access antes de llegar al Worker. Si ves una ruta sin chequeo de sesión, es intencional, no un bug.

## Testing

- Antes de marcar cualquier cambio en `src/liquidaciones/motores.ts` (u otra lógica de cálculo) como terminado, agregá o actualizá el test correspondiente en el archivo `.test.ts` junto al módulo — es lógica pura de montos legales, sin red de seguridad no se detectan regresiones.
- Los motores de liquidación tienen reglas legales verificadas contra texto de ley específico (ver comentarios al inicio de `motores.ts`). No completes un motor marcado como "PENDIENTE" o "ESQUELETO" con valores recordados de memoria — el propio archivo lo prohíbe explícitamente.
- Para rutas que tocan D1/R2, todavía no hay tests de integración armados (pendiente). Si agregás uno, usará el mismo `vitest.config.ts` — no crees un segundo runner.

## Qué evitar

- No agregues autenticación/autorización dentro de una ruta — rompe el supuesto de que Access ya filtró el tráfico.
- No hardcodees español mezclado con inglés en identificadores nuevos.
- No actives (descomentes) `MotorLCT` o `MotorConstruccion` sin que el texto legal vigente se haya confirmado en la conversación — están comentados a propósito.
