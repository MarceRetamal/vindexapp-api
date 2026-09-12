# CLAUDE.md

Backend de VINDEX LEGAL App: Cloudflare Worker (Hono) + D1 + R2. Ver `README.md` para contexto de producto.

## Comandos

- `npm run dev` — levanta el Worker local (usa bindings remotos de D1/R2 vía `remote: true`; hace falta `npx wrangler login` la primera vez).
- `npm run typecheck` — `tsc --noEmit`. Correlo antes de dar por terminado cualquier cambio; `strict` + `noUncheckedIndexedAccess` están activos.
- `npm test` — `vitest run` sobre `@cloudflare/vitest-pool-workers`. Corre 100% local (D1 en memoria vía `d1Databases: ['DB']` en `vitest.config.ts`, esquema real aplicado desde `migrations/` por `test/aplicar-migraciones.ts`) — **no** lee los bindings `remote: true` de `wrangler.jsonc`, así que no requiere `wrangler login` ni toca D1/R2 de producción.
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

**Actualizado 2026-09-12: esta sección reemplaza la convención anterior** (que decía que ninguna ruta debía agregar su propio middleware de auth, porque "todo el tráfico ya pasa por Access antes de llegar al Worker"). Esa premisa dejaba un agujero de seguridad real: Access protege el borde, pero dentro del Worker cualquier ruta que confiara en un `estudio_id` mandado por el cliente (query param o body) permitía a un estudio leer o escribir datos de otro. Se cerró ese agujero agregando auth explícita en el código:

- Cada router en `src/rutas/` que toca datos de negocio monta `xRouter.use('*', requireAuth())` (ver `src/middleware/auth.ts`) al principio del archivo.
- `requireAuth()` verifica el JWT de Cloudflare Access (`Cf-Access-Jwt-Assertion`) con `jose` — **no** con `ctx.access` (la API nativa), porque `ctx.access` no se puede simular en `vitest-pool-workers`/Miniflare, así que ninguna prueba real de aislamiento podría escribirse contra ella. Se verifica el JWT a mano por eso, y además porque el fallback `*.workers.dev` de un Worker no queda protegido por Access, así que no hay que confiar únicamente en el filtrado del borde.
- El middleware resuelve el usuario en D1 por email y setea `c.set('auth', { usuario_id, estudio_id, rol, email })`. **Todo `estudio_id` usado en una ruta debe salir de `c.get('auth').estudio_id`, nunca de query/body/params** — y toda fila leída/actualizada/borrada por id debe validar `WHERE id = ? AND estudio_id = ?` (o el join equivalente cuando el id es de una tabla relacionada, ej. `expediente_id`).
- Rutas ya migradas a este patrón: `clientes`, `expedientes`, `documentos`, `presupuestos`, `actuaciones`, `audiencias`, `estrategias`, `templates`, `usuarios`, `whoami`, `dashboard`, `reportes`, `tareas`, `generador-documentos`, `google-calendar`. No queda ninguna ruta de negocio pendiente de este patrón. `google-calendar` además dejó de portar `usuario_id` en el parámetro `state` de OAuth (era un vector de secuestro de cuenta: permitía atar el token de Google de un atacante al `usuario_id` de otra persona) — `state` ahora es un nonce opaco sin significado, y `/callback` resuelve el usuario real vía `requireAuth()`, igual que el resto.
- Tests de integración de rutas protegidas: no uses `SELF.fetch` (pega contra el `index.ts` completo, cuyo `requireAuth()` sin resolver inyectado sale a la red real de Cloudflare Access y siempre da 401 en el sandbox de test). Usá `crearAppAutenticada()`/`crearUsuarioAutenticado()` de `test/auth.ts`, que montan el router real pero fuerzan a `requireAuth()` a resolver contra un JWKS local en memoria (ver `_establecerJWKSDePruebaParaTests` en `src/middleware/auth.ts` — es un seam de test explícito, no hay otra forma de inyectar el resolver dentro de un router que ya lo monta a nivel de módulo).

## Testing

- Antes de marcar cualquier cambio en `src/liquidaciones/motores.ts` (u otra lógica de cálculo) como terminado, agregá o actualizá el test correspondiente en el archivo `.test.ts` junto al módulo — es lógica pura de montos legales, sin red de seguridad no se detectan regresiones.
- Los motores de liquidación tienen reglas legales verificadas contra texto de ley específico (ver comentarios al inicio de `motores.ts`). No completes un motor marcado como "PENDIENTE" o "ESQUELETO" con valores recordados de memoria — el propio archivo lo prohíbe explícitamente.
- Tests de integración de rutas que tocan D1: `src/rutas/<entidad>.integration.test.ts`, vía `SELF.fetch(...)` (importado de `cloudflare:test`) contra el Worker completo. Usá `crearEstudioDePrueba()` de `test/fixtures.ts` para el `estudio_id` — casi toda tabla lo exige por FK. Import `env` desde `test/env.ts` (no directo de `cloudflare:test`) para tener `env.DB` tipado contra `Bindings`. Ver `src/rutas/clientes.integration.test.ts` como referencia del patrón (camino feliz, 400 de validación, 404, y el 409 del constraint UNIQUE por estudio).
- Al sumar una tabla nueva a `migrations/`, no hace falta tocar `vitest.config.ts` — `readD1Migrations()` lee todo `migrations/` en cada corrida.
- **D1 no se resetea entre tests dentro del mismo archivo** (mismo Worker/storage para todo el archivo). Las tablas con `estudio_id` no sufren esto porque cada test crea su propio estudio con `crearEstudioDePrueba()` y filtra por ahí. La tabla `estudios` no tiene ese aislamiento (es la raíz): no asumas que un `GET` sin filtro devuelve solo lo que insertó tu test — comparás por ID específico, no por índice 0 de la lista completa (ver `estudios.integration.test.ts`).
- Rutas que tocan R2 (ej. `documentos`): el binding `DOCUMENTOS` también es local (`r2Buckets: ['DOCUMENTOS']` en `vitest.config.ts`), con credenciales de firma dummies. `firmarUrlR2()` (`src/lib/r2-firmado.ts`) solo firma la URL con `aws4fetch`, no hace ningún request real — no intentes simular el PUT del frontend pegándole a `url_subida`, va a una cuenta R2 que no existe. Para simular "el frontend ya subió el archivo", escribí directo con `env.DOCUMENTOS.put(ruta_r2, contenido)` antes de llamar a `/confirmar-subida` (ver `documentos.integration.test.ts`).

## Qué evitar

- No agregues estudio_id/usuario_id tomado de query/body/params en una ruta protegida — siempre debe salir de c.get('auth') (ver "Autenticación" arriba).
- No hardcodees español mezclado con inglés en identificadores nuevos.
- No actives (descomentes) `MotorLCT` o `MotorConstruccion` sin que el texto legal vigente se haya confirmado en la conversación — están comentados a propósito.
