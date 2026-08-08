# Cierre de M1 — Autenticación, aislamiento por estudio y auditoría

**Fecha:** 2026-08-07
**Repos afectados:** `vindexapp-api` (principal), `vindexapp-frontend` (cambios menores)
**Milestone:** M1 (Core CRUD: Cliente, Expediente, Estudio/Abogado auth) — cierre

## Contexto

`vindexapp-api` y `vindexapp-frontend` ya implementan la mayor parte del modelo de
dominio de VINDEX LEGAL App (estudios, usuarios, clientes, expedientes, documentos,
presupuestos, estrategias, actuaciones, audiencias, movimientos, mensajes). Lo que
falta para cerrar M1 es autenticación real y el cierre de los huecos de aislamiento
multi-tenant que esa falta de autenticación dejó expuestos.

Un audit de seguridad (cyber-neo, 2026-08-07) sobre `vindexapp-api` encontró:

1. **Crítico — Sin autenticación.** Todas las rutas bajo `/api/*` son alcanzables por
   cualquiera que tenga la URL del Worker.
2. **Crítico — Fuga de aislamiento por `estudio_id` (IDOR) en 6 endpoints:**
   - `clientes.ts` `GET /:id`
   - `usuarios.ts` `GET /` (sin `estudio_id` en query, devuelve todos los estudios)
   - `estrategias.ts` `PATCH /:id`
   - `actuaciones.ts` `PATCH /:id/notificar`
   - `presupuestos.ts` `PATCH /:id/estado`
   - `audiencias.ts` `PATCH /:id/estado`

   El patrón correcto ya existe en `expedientes.ts` `GET /:id` y en
   `documentos.ts` `GET /:id/descargar` (ambos bindean `id` + `estudio_id`).
3. Dependencias desactualizadas dentro del rango ya permitido por `package.json`
   (`hono`, `wrangler`) con fixes conocidos de CORS/cache.

Estos hallazgos coinciden con lo que ya estaba pendiente en el README de
`vindexapp-api` ("Cloudflare Access delante de este Worker, login por credenciales
de abogado, vía Google Workspace") — no es una decisión nueva, es completar una ya
tomada.

Decisiones ya confirmadas por el usuario para este trabajo:

- El dominio `vindexlegal.com.ar` ya está gestionado en la cuenta de Cloudflare.
- Se suma la tabla de auditoría (§2 del spec general) ahora, en este mismo cierre,
  porque recién con auth hay un `usuario_id` confiable para el campo "quién".

## Arquitectura de autenticación

**Dominios.** Se agrega un dominio custom para la API, `api.vindexlegal.com.ar`
(ruta en `wrangler.jsonc`), para que quede bajo el mismo dominio raíz que
`panel.vindexlegal.com.ar`. Esto permite que la cookie de sesión de Cloudflare
Access (`CF_Authorization`) viaje entre panel y API sin fricción de cookies
cross-site. El subdominio `*.workers.dev` se documenta como "no usar en
producción" — no tiene Cloudflare Access aplicado a nivel de borde.

**Identity provider.** Google Workspace, vía una aplicación de Cloudflare Access
configurada en el dashboard de Zero Trust (fuera del alcance de este repo — lo
configura el usuario; el Worker solo necesita el dominio del team y el AUD tag
resultante).

**Verificación server-side (defensa en profundidad).** Cloudflare Access protege
el dominio a nivel de borde, pero el Worker **no confía ciegamente** en eso: cada
request a `/api/*` (excepto `/api/salud`) pasa por un middleware que:

1. Lee el header `Cf-Access-Jwt-Assertion`.
2. Verifica la firma contra el JWKS de Access
   (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`), usando `jose`
   (`createRemoteJWKSet`, que cachea las claves en memoria del Worker).
3. Valida `aud` (coincide con el AUD tag de la app de Access) y expiración.
4. Si es válido, extrae el claim `email` y busca en `usuarios` un registro con ese
   email y `activo = 1`.
5. Si todo lo anterior se cumple, setea en el contexto de Hono:
   `c.set('auth', { usuario_id, estudio_id, rol, email })`.

Este paso es necesario precisamente porque el fallback `*.workers.dev` no tiene
Access aplicado — sin verificación server-side, alguien podría saltear el login
pegándole directo al Worker.

**Errores de autenticación:**

- JWT ausente o inválido (firma, `aud`, expiración) → `401`
  `{ error: 'No autenticado.' }`.
- JWT válido pero el email no está en `usuarios`, o está `activo = 0` → `403`
  `{ error: 'Usuario no habilitado en el sistema.' }`. Este caso distingue
  "sos una identidad válida de Google Workspace" de "todavía no estás dado de
  alta en VINDEX" — útil al incorporar abogados nuevos.

## Cierre del aislamiento por estudio (revisión de alcance)

Los 6 endpoints listados arriba son los que el audit marcó porque **no filtran
por `estudio_id` en absoluto**. Pero hay un problema más amplio que la
autenticación deja al descubierto: incluso las rutas que hoy sí filtran
correctamente (`expedientes.ts`, `documentos.ts`, y los `GET`/`POST` del resto
de los routers) lo hacen confiando en un `estudio_id` que **viene del que
llama** (query param o body). Una vez que hay autenticación real, seguir
confiando en ese valor recrea el mismo problema: un usuario autenticado del
Estudio A podría mandar `estudio_id` del Estudio B en la query o en el body y
listar, crear o filtrar datos de otro estudio.

Por eso la regla se aplica parejo a **todos** los routers de datos de negocio
(`clientes`, `usuarios`, `expedientes`, `documentos`, `presupuestos`,
`estrategias`, `actuaciones`, `audiencias`, `templates`): ningún handler vuelve
a leer `estudio_id` de query params ni de body. Siempre se lee de
`c.get('auth').estudio_id` (fuente confiable, derivada del JWT verificado). Esto
incluye tanto los 6 endpoints marcados por el audit como los que ya filtraban
"bien" pero seguían tomando el valor del cliente.

Quedan afuera de esta regla `estudios.ts` (alta y listado del propio estudio:
es la ruta de bootstrap que se usa antes de que exista ningún `usuario` con el
que autenticar, igual que `/api/salud`) y — por supuesto — la ruta de
autenticación misma.

Cuando un `id` de la URL pertenece a otro estudio, la respuesta es `404` (no
`403`) — para no confirmar la existencia del recurso en otro tenant. Ya es el
estilo de error usado en el resto del código (`"Cliente no encontrado."`, etc.).

`usuarios.ts` `GET /` dejar de aceptar `estudio_id` como query param opcional:
siempre filtra por el `estudio_id` del contexto autenticado, sin excepción.

## Auditoría

Nueva migración `0003_auditoria.sql`:

```sql
CREATE TABLE auditoria (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  usuario_id    TEXT NOT NULL REFERENCES usuarios(id),
  entidad       TEXT NOT NULL CHECK (entidad IN ('expediente','documento')),
  entidad_id    TEXT NOT NULL,
  accion        TEXT NOT NULL CHECK (accion IN ('crear','actualizar','eliminar')),
  detalle       TEXT,              -- JSON con campos cambiados, opcional
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad, entidad_id);
CREATE INDEX idx_auditoria_estudio ON auditoria(estudio_id);
```

Alcance acotado a `expediente` y `documento` — es lo que pide explícitamente el
§2 del spec general ("cada escritura sobre un Expediente... requerido para
responsabilidad profesional y para el 'MEV interno'"). Se puede extender a otras
entidades más adelante sin rediseñar la tabla.

Un helper `registrarAuditoria(c, { entidad, entidad_id, accion, detalle })` en
`src/db/auditoria.ts` inserta la fila, tomando `usuario_id`/`estudio_id` del
contexto de auth. Se llama desde los handlers `POST`/`PATCH`/`DELETE` de
`expedientes.ts` y `documentos.ts`.

## Componentes tocados

### `vindexapp-api`

- `src/middleware/auth.ts` (nuevo) — verificación de JWT + resolución de usuario +
  inyección de contexto.
- `src/db/auditoria.ts` (nuevo) — helper de inserción de auditoría.
- `src/tipos.ts` — agrega `ACCESS_TEAM_DOMINIO` y `ACCESS_AUD` a `Bindings`.
- `src/rutas/clientes.ts`, `usuarios.ts`, `estrategias.ts`, `actuaciones.ts`,
  `presupuestos.ts`, `audiencias.ts` — reemplazar lectura de `estudio_id` desde
  query/body por lectura desde el contexto de auth.
- `src/rutas/expedientes.ts`, `documentos.ts` — sumar llamadas a
  `registrarAuditoria` en los writes.
- `src/rutas/auth.ts` (nuevo) — `GET /api/auth/whoami`, devuelve
  `{ usuario_id, nombre, apellido, estudio_id, rol }` del contexto autenticado.
- `migrations/0003_auditoria.sql` (nuevo).
- `wrangler.jsonc` — ruta de dominio custom `api.vindexlegal.com.ar`.
- `package.json` — agrega `jose`; actualiza `hono` y `wrangler` dentro del rango
  `^` ya declarado.
- `.env.example` (nuevo) — documenta `ACCESS_TEAM_DOMINIO` y `ACCESS_AUD` (no son
  secretos: son identificadores públicos de la app de Access, pero se documentan
  igual para que el entorno local sea reproducible).

### `vindexapp-frontend`

- `src/api/whoami.ts` (nuevo) — llama a `/api/auth/whoami` al montar la app.
- `src/componentes/Layout.tsx` — muestra "Hola, {nombre}" usando el resultado de
  whoami.
- `src/api/http.ts` — asegura `credentials: 'include'` en cada fetch, para que la
  cookie de Access viaje entre `panel.vindexlegal.com.ar` y
  `api.vindexlegal.com.ar`.

No se agrega pantalla de login propia: Cloudflare Access intercepta a nivel de
borde antes de que cargue el SPA.

## Fuera de alcance de este cierre de M1

- Configuración de la aplicación de Access en el dashboard de Zero Trust
  (Google Workspace como IdP, políticas de acceso) — la hace el usuario
  manualmente; no hay tooling disponible en esta sesión para administrarla vía
  API.
- RBAC granular por `rol` (`titular` / `asociado` / `administrativo`) más allá de
  la resolución del rol en el contexto de auth. Con un solo usuario activo hoy,
  no hay reglas de negocio que dependan del rol todavía; se diseña cuando haya un
  segundo usuario real en un estudio.
- Extender `auditoria` a entidades más allá de `expediente`/`documento`.
- Calculador de plazos procesales (M3) y su suite de tests específica.
- Fase 2 de PJN/MEV (§4) — no forma parte de este cierre de M1.

## Testing

Primeros tests del repo (no existían antes). Se agrega
`@cloudflare/vitest-pool-workers` + `vitest`.

- **Middleware de auth:** token válido, token expirado, `aud` incorrecto, token
  malformado, token válido pero email no provisto en `usuarios`, email provisto
  pero `activo = 0`.
- **Aislamiento por estudio:** para cada uno de los 6 endpoints corregidos, un
  test que crea datos en el Estudio A y el Estudio B, autentica como usuario del
  Estudio A, y verifica que no puede leer ni escribir el recurso del Estudio B
  (`404`).
- **Auditoría:** crear/actualizar/eliminar un expediente y un documento, y
  verificar que queda una fila en `auditoria` con `usuario_id`/`estudio_id`
  correctos.

## Riesgos y mitigaciones

- **Quedar bloqueado fuera del sistema si Access está mal configurado.** Mitigar
  documentando en el README el proceso exacto de configuración de la app de
  Access y dejando, solo durante la puesta en marcha, el acceso también
  disponible por `*.workers.dev` sin Access (pero sí con verificación de JWT, que
  fallará sin un JWT válido) para poder diagnosticar problemas de DNS/Access sin
  quedar totalmente afuera.
- **Regresión de aislamiento en rutas futuras.** El helper de auth centraliza la
  fuente de `estudio_id`; cualquier ruta nueva que lea `estudio_id` de
  query/body en lugar del contexto es una regresión fácil de detectar en code
  review porque rompe el patrón ya establecido en el resto del router.
