# Cierre de M1 (auth, aislamiento por estudio, auditoría) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar M1 de VINDEX LEGAL App agregando autenticación real (Cloudflare Access verificado server-side), corrigiendo el aislamiento por `estudio_id` en todos los routers de datos, y sumando un log de auditoría sobre expedientes y documentos.

**Architecture:** Un middleware de Hono (`requireAuth`) verifica el JWT que Cloudflare Access agrega a cada request (`Cf-Access-Jwt-Assertion`) contra el JWKS de Access, resuelve el usuario en D1 por email, e inyecta `{ usuario_id, estudio_id, rol, email }` en el contexto de cada handler. Todos los routers de datos dejan de confiar en un `estudio_id` provisto por quien llama y lo toman siempre de ese contexto. Un helper de auditoría registra cada alta de expediente/documento.

**Tech Stack:** Hono 4, Cloudflare Workers + D1 + R2, `jose` (verificación JWT), `vitest` + `@cloudflare/vitest-pool-workers` (primeros tests del repo), React 19 + Vite en el frontend.

**Repos:** `vindexapp-api` (Tasks 1–6, 8), `vindexapp-frontend` (Task 7, 8).

## Global Constraints

- Ningún endpoint de datos de negocio vuelve a leer `estudio_id` de query params o body — siempre del contexto de auth (spec, "Cierre del aislamiento por estudio"). Excepción explícita: `estudios.ts` (bootstrap, sin usuario todavía) y `/api/salud`.
- Verificación de JWT server-side siempre, aunque Access ya filtre a nivel de borde — el fallback `*.workers.dev` no tiene Access aplicado (spec, "Arquitectura de autenticación").
- Nunca commitear secretos reales; todo secreto/config nuevo se documenta en `.env.example` (regla de sesión).
- No se agrega RBAC granular por `rol` más allá de resolverlo en el contexto — está fuera de alcance de este cierre de M1 (spec, "Fuera de alcance").
- No se toca el calculador de plazos (M3), ni Fase 2 de PJN/MEV (§4) — fuera de alcance.
- Copy nueva de UI en español (aplica al Task 7, frontend).
- Cada tarea termina con un commit propio.

---

### Task 1: Dependencias, dominio custom y arnés de testing

**Files:**
- Modify: `vindexapp-api/package.json`
- Modify: `vindexapp-api/wrangler.jsonc`
- Create: `vindexapp-api/vitest.config.ts`
- Create: `vindexapp-api/vitest-env.d.ts`
- Create: `vindexapp-api/test/aplicar-migraciones.ts`
- Create: `vindexapp-api/.env.example`

**Interfaces:**
- Produces: comando `npm test` (vitest + `@cloudflare/vitest-pool-workers`) corriendo contra un D1 real (Miniflare) con las migraciones ya aplicadas antes de cada archivo de test. Todas las tareas siguientes escriben sus tests asumiendo esto.

- [ ] **Step 1: Instalar dependencias nuevas**

Ejecutar dentro de `vindexapp-api/`:

```bash
npm install jose
npm install --save-dev vitest @cloudflare/vitest-pool-workers
npm update hono wrangler
```

(`npm update` alcanza para el fix del audit — `hono` y `wrangler` ya lo permite el rango `^` existente en `package.json`.)

- [ ] **Step 2: Agregar el script de test**

En `vindexapp-api/package.json`, dentro de `"scripts"`, agregar junto a `"typecheck"`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Agregar el dominio custom de la API a `wrangler.jsonc`**

Agregar después de `"compatibility_flags"` en `vindexapp-api/wrangler.jsonc`:

```jsonc
  "routes": [
    { "pattern": "api.vindexlegal.com.ar/*", "custom_domain": true }
  ],

  "vars": {
    // Team domain de Cloudflare Zero Trust (la parte antes de
    // ".cloudflareaccess.com"). Reemplazar por el valor real una vez
    // creado el team en el dashboard de Zero Trust.
    "ACCESS_TEAM_DOMINIO": "vindexlegal",
    // AUD tag de la aplicación de Access que protege este Worker.
    // Se obtiene del dashboard al crear la app de Access. No es secreto
    // (identifica la app, no autentica), pero hay que reemplazarlo por
    // el valor real antes de desplegar.
    "ACCESS_AUD": "REEMPLAZAR_CON_AUD_TAG_REAL"
  },
```

- [ ] **Step 4: Crear `test/aplicar-migraciones.ts`**

```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 5: Crear `vitest.config.ts`**

```ts
import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return {
    test: {
      setupFiles: ['./test/aplicar-migraciones.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Valores fijos de prueba, independientes de los reales de
              // wrangler.jsonc, para que los tests de auth no dependan de
              // configuración de producción.
              ACCESS_TEAM_DOMINIO: 'equipo-de-prueba',
              ACCESS_AUD: 'aud-de-prueba',
            },
          },
        },
      },
    },
  };
});
```

- [ ] **Step 6: Crear `vitest-env.d.ts` para tipar `env` en los tests**

```ts
import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';
import type { Bindings } from './src/tipos';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Bindings {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 7: Crear `.env.example`**

```bash
# vindexapp-api/.env.example
#
# Variables no secretas ya declaradas en wrangler.jsonc bajo "vars"
# (ACCESS_TEAM_DOMINIO, ACCESS_AUD) — no hace falta duplicarlas acá salvo
# que se quiera overridear en desarrollo local vía .dev.vars.
#
# Este archivo documenta qué .dev.vars local hace falta para levantar el
# Worker con `wrangler dev`. Copiar a `.dev.vars` (gitignoreado) y completar.

# Team domain de Cloudflare Zero Trust, si se quiere overridear el de
# wrangler.jsonc en desarrollo local.
# ACCESS_TEAM_DOMINIO=vindexlegal

# AUD tag de la app de Access, si se quiere overridear el de wrangler.jsonc
# en desarrollo local.
# ACCESS_AUD=
```

- [ ] **Step 8: Verificar que el arnés levanta**

Run: `npm run typecheck && npm test`
Expected: `typecheck` sin errores; `vitest` corre y reporta "No test files found" (todavía no hay tests) sin fallar por configuración.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json wrangler.jsonc vitest.config.ts vitest-env.d.ts test/aplicar-migraciones.ts .env.example
git commit -m "Agregar arnes de testing (vitest-pool-workers), dominio custom de la API y jose"
```

---

### Task 2: Migración de auditoría

**Files:**
- Create: `vindexapp-api/migrations/0003_auditoria.sql`

**Interfaces:**
- Produces: tabla `auditoria(id, estudio_id, usuario_id, entidad, entidad_id, accion, detalle, creado_en)`, usada por Task 6.

- [ ] **Step 1: Crear la migración**

```sql
-- Migration number: 0003   2026-08-07
CREATE TABLE auditoria (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  usuario_id    TEXT NOT NULL REFERENCES usuarios(id),
  entidad       TEXT NOT NULL CHECK (entidad IN ('expediente','documento')),
  entidad_id    TEXT NOT NULL,
  accion        TEXT NOT NULL CHECK (accion IN ('crear','actualizar','eliminar')),
  detalle       TEXT,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_auditoria_entidad ON auditoria(entidad, entidad_id);
CREATE INDEX idx_auditoria_estudio ON auditoria(estudio_id);
```

- [ ] **Step 2: Aplicarla localmente y verificar**

Run: `npx wrangler d1 migrations apply vindexapp-interna --local`
Expected: reporta la migración `0003_auditoria` aplicada.

Run: `npx wrangler d1 execute vindexapp-interna --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='auditoria'"`
Expected: devuelve una fila con `name: auditoria`.

- [ ] **Step 3: Commit**

```bash
git add migrations/0003_auditoria.sql
git commit -m "Agregar tabla auditoria (migracion 0003)"
```

---

### Task 3: Middleware de autenticación

**Files:**
- Create: `vindexapp-api/src/middleware/auth.ts`
- Create: `vindexapp-api/src/middleware/auth.test.ts`
- Create: `vindexapp-api/src/middleware/auth.integration.test.ts`
- Modify: `vindexapp-api/src/tipos.ts`

**Interfaces:**
- Consumes: `Bindings.DB` (D1Database), `Bindings.ACCESS_TEAM_DOMINIO`, `Bindings.ACCESS_AUD` (de `tipos.ts`, ya declarados... ver Step 3 de este task, que los agrega).
- Produces:
  - `interface AuthContext { usuario_id: string; estudio_id: string; rol: string; email: string }` (exportado desde `src/middleware/auth.ts`)
  - `interface Env { Bindings: Bindings; Variables: { auth: AuthContext } }` (exportado desde `src/tipos.ts`) — Task 4 y Task 5 tipan todos los routers con `new Hono<Env>()`.
  - `function requireAuth(resolverJWKS?: ResolverJWKS): MiddlewareHandler<{ Bindings: Bindings; Variables: { auth: AuthContext } }>` — Task 4/5 lo montan como `xRouter.use('*', requireAuth())`.
  - `function verificarAccessJWT(token: string, jwks: JWTVerifyGetKey, audienciaEsperada: string): Promise<{ email: string }>` — función pura, testeada acá directamente.

- [ ] **Step 1: Agregar los bindings de Access a `tipos.ts`**

Reemplazar el contenido completo de `src/tipos.ts`:

```ts
import type { AuthContext } from './middleware/auth';

/**
 * Bindings disponibles en el entorno del Worker.
 * Deben coincidir exactamente con lo declarado en wrangler.jsonc.
 */
export interface Bindings {
  DB: D1Database;
  DOCUMENTOS: R2Bucket;
  ACCESS_TEAM_DOMINIO: string;
  ACCESS_AUD: string;
}

/** Tipo de entorno de Hono compartido por los routers protegidos con requireAuth. */
export interface Env {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
}
```

- [ ] **Step 2: Escribir el test de `verificarAccessJWT` (falla primero)**

Crear `src/middleware/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import { verificarAccessJWT } from './auth';

const AUDIENCIA = 'aud-de-prueba';

async function crearJWKSDePrueba() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'clave-de-prueba';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, jwks };
}

async function firmarToken(
  privateKey: CryptoKey,
  opciones: { email?: string; audiencia?: string; expiracionUnix?: number }
) {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT(opciones.email ? { email: opciones.email } : {})
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience(opciones.audiencia ?? AUDIENCIA)
    .setExpirationTime(opciones.expiracionUnix ?? ahora + 300)
    .sign(privateKey);
}

describe('verificarAccessJWT', () => {
  it('acepta un token valido y devuelve el email', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, { email: 'abogada@vindexlegal.com.ar' });

    const resultado = await verificarAccessJWT(token, jwks, AUDIENCIA);

    expect(resultado.email).toBe('abogada@vindexlegal.com.ar');
  });

  it('rechaza un token expirado', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const ahora = Math.floor(Date.now() / 1000);
    const token = await firmarToken(privateKey, {
      email: 'abogada@vindexlegal.com.ar',
      expiracionUnix: ahora - 60,
    });

    await expect(verificarAccessJWT(token, jwks, AUDIENCIA)).rejects.toThrow();
  });

  it('rechaza un token con audiencia incorrecta', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, {
      email: 'abogada@vindexlegal.com.ar',
      audiencia: 'otra-audiencia',
    });

    await expect(verificarAccessJWT(token, jwks, AUDIENCIA)).rejects.toThrow();
  });

  it('rechaza un token malformado', async () => {
    const { jwks } = await crearJWKSDePrueba();

    await expect(verificarAccessJWT('esto-no-es-un-jwt', jwks, AUDIENCIA)).rejects.toThrow();
  });

  it('rechaza un token valido sin claim de email', async () => {
    const { privateKey, jwks } = await crearJWKSDePrueba();
    const token = await firmarToken(privateKey, {});

    await expect(verificarAccessJWT(token, jwks, AUDIENCIA)).rejects.toThrow(
      'El token no incluye un email válido.'
    );
  });
});
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npm test -- auth.test`
Expected: FAIL — `verificarAccessJWT` no está definido (todavía no existe `src/middleware/auth.ts`).

- [ ] **Step 4: Implementar `src/middleware/auth.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Bindings } from '../tipos';

export interface AuthContext {
  usuario_id: string;
  estudio_id: string;
  rol: string;
  email: string;
}

export type ResolverJWKS = (teamDominio: string) => JWTVerifyGetKey;

const cacheJWKS = new Map<string, JWTVerifyGetKey>();

/** JWKS real de Cloudflare Access, cacheado en memoria del Worker. */
export function obtenerJWKS(teamDominio: string): JWTVerifyGetKey {
  const existente = cacheJWKS.get(teamDominio);
  if (existente) return existente;

  const jwks = createRemoteJWKSet(
    new URL(`https://${teamDominio}.cloudflareaccess.com/cdn-cgi/access/certs`)
  );
  cacheJWKS.set(teamDominio, jwks);
  return jwks;
}

/**
 * Verifica un JWT de Cloudflare Access (firma, audiencia, expiracion) y
 * devuelve el email del claim. No toca la base — eso lo hace requireAuth.
 */
export async function verificarAccessJWT(
  token: string,
  jwks: JWTVerifyGetKey,
  audienciaEsperada: string
): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, jwks, { audience: audienciaEsperada });

  if (typeof payload.email !== 'string' || !payload.email) {
    throw new Error('El token no incluye un email válido.');
  }

  return { email: payload.email };
}

/**
 * Middleware de Hono: exige un JWT de Access valido, resuelve el usuario
 * en D1 por email, e inyecta { usuario_id, estudio_id, rol, email } en el
 * contexto. resolverJWKS es inyectable para poder testear sin red.
 */
export function requireAuth(
  resolverJWKS: ResolverJWKS = obtenerJWKS
): MiddlewareHandler<{ Bindings: Bindings; Variables: { auth: AuthContext } }> {
  return async (c, next) => {
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) {
      return c.json({ error: 'No autenticado.' }, 401);
    }

    let email: string;
    try {
      const jwks = resolverJWKS(c.env.ACCESS_TEAM_DOMINIO);
      const verificado = await verificarAccessJWT(token, jwks, c.env.ACCESS_AUD);
      email = verificado.email;
    } catch {
      return c.json({ error: 'No autenticado.' }, 401);
    }

    const usuario = await c.env.DB.prepare(
      'SELECT id, estudio_id, rol FROM usuarios WHERE email = ? AND activo = 1'
    )
      .bind(email)
      .first<{ id: string; estudio_id: string; rol: string }>();

    if (!usuario) {
      return c.json({ error: 'Usuario no habilitado en el sistema.' }, 403);
    }

    c.set('auth', {
      usuario_id: usuario.id,
      estudio_id: usuario.estudio_id,
      rol: usuario.rol,
      email,
    });

    await next();
  };
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test -- auth.test`
Expected: PASS — los 5 tests de `verificarAccessJWT`.

- [ ] **Step 6: Escribir el test de integración de `requireAuth` (falla primero)**

Crear `src/middleware/auth.integration.test.ts`:

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import { requireAuth, type AuthContext } from './auth';
import type { Env } from '../tipos';

const AUDIENCIA = 'aud-de-prueba';
let jwksDePrueba: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const par = await generateKeyPair('RS256');
  privateKey = par.privateKey;
  const jwk = await exportJWK(par.publicKey);
  jwk.kid = 'clave-de-prueba';
  jwksDePrueba = createLocalJWKSet({ keys: [jwk] });
});

async function firmarToken(email?: string) {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT(email ? { email } : {})
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience(AUDIENCIA)
    .setExpirationTime(ahora + 300)
    .sign(privateKey);
}

function crearAppDePrueba() {
  const app = new Hono<Env>();
  app.use('*', requireAuth(() => jwksDePrueba));
  app.get('/protegido', (c) => c.json(c.get('auth')));
  return app;
}

describe('requireAuth', () => {
  it('devuelve 401 sin token', async () => {
    const app = crearAppDePrueba();
    const res = await app.request('/protegido', {}, env);
    expect(res.status).toBe(401);
  });

  it('devuelve 403 si el email no esta dado de alta', async () => {
    const app = crearAppDePrueba();
    const token = await firmarToken('nadie@vindexlegal.com.ar');

    const res = await app.request(
      '/protegido',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env
    );

    expect(res.status).toBe(403);
  });

  it('setea el contexto de auth para un usuario activo', async () => {
    await env.DB.prepare(
      `INSERT INTO estudios (id, nombre, creado_en, activo) VALUES ('estudio-test-auth', 'Estudio Test', 0, 1)`
    ).run();
    await env.DB.prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES ('usuario-test-auth', 'estudio-test-auth', 'Ada', 'Lovelace', 'ada@vindexlegal.com.ar', 'titular', 1, 0)`
    ).run();

    const app = crearAppDePrueba();
    const token = await firmarToken('ada@vindexlegal.com.ar');

    const res = await app.request(
      '/protegido',
      { headers: { 'Cf-Access-Jwt-Assertion': token } },
      env
    );

    expect(res.status).toBe(200);
    const cuerpo = await res.json<AuthContext>();
    expect(cuerpo).toEqual({
      usuario_id: 'usuario-test-auth',
      estudio_id: 'estudio-test-auth',
      rol: 'titular',
      email: 'ada@vindexlegal.com.ar',
    });
  });
});
```

- [ ] **Step 7: Correr y verificar que pasa (ya con la implementación del Step 4 lista, este archivo nuevo debería pasar directo)**

Run: `npm test -- auth.integration.test`
Expected: PASS — los 3 tests.

- [ ] **Step 8: Typecheck completo**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/tipos.ts src/middleware/auth.ts src/middleware/auth.test.ts src/middleware/auth.integration.test.ts
git commit -m "Agregar middleware de autenticacion (verificacion JWT de Access + resolucion de usuario)"
```

---

### Task 4: Ruta `whoami` y montaje de `requireAuth`

**Files:**
- Create: `vindexapp-api/src/rutas/auth.ts`
- Modify: `vindexapp-api/src/index.ts`

**Interfaces:**
- Consumes: `requireAuth`, `AuthContext` (de `src/middleware/auth.ts`, Task 3), `Env` (de `src/tipos.ts`, Task 3).
- Produces: `GET /api/auth/whoami` → `{ usuario_id, nombre, apellido, estudio_id, rol }`, consumido por el frontend en Task 7.

- [ ] **Step 1: Crear `src/rutas/auth.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const authRouter = new Hono<Env>();

authRouter.use('*', requireAuth());

/** Identidad del usuario autenticado — la usa el panel para mostrar "Hola, {nombre}". */
authRouter.get('/whoami', async (c) => {
  const auth = c.get('auth');

  const usuario = await c.env.DB.prepare(
    'SELECT nombre, apellido FROM usuarios WHERE id = ?'
  )
    .bind(auth.usuario_id)
    .first<{ nombre: string; apellido: string }>();

  return c.json({
    usuario_id: auth.usuario_id,
    nombre: usuario?.nombre ?? '',
    apellido: usuario?.apellido ?? '',
    estudio_id: auth.estudio_id,
    rol: auth.rol,
  });
});
```

- [ ] **Step 2: Montar `authRouter` y habilitar `credentials` en CORS, en `src/index.ts`**

Reemplazar el bloque de imports y montaje de rutas en `src/index.ts`. Notar que
`app` sigue tipado con `Bindings` (no `Env`): `index.ts` nunca llama a
`c.get('auth')` directamente, eso lo hace cada router; forzar `Env` acá
obligaría a todos los sub-routers montados (incluido `estudiosRouter`, que
intencionalmente no lleva `requireAuth`) a compartir el mismo `Variables`, sin
necesidad real.

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './tipos';
import { estudiosRouter } from './rutas/estudios';
import { usuariosRouter } from './rutas/usuarios';
import { clientesRouter } from './rutas/clientes';
import { expedientesRouter } from './rutas/expedientes';
import { documentosRouter } from './rutas/documentos';
import { presupuestosRouter } from './rutas/presupuestos';
import { estrategiasRouter } from './rutas/estrategias';
import { actuacionesRouter } from './rutas/actuaciones';
import { templatesRouter } from './rutas/templates';
import { audienciasRouter } from './rutas/audiencias';
import { authRouter } from './rutas/auth';

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'https://panel.vindexlegal.com.ar'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  })
);

app.route('/api/auth', authRouter);
app.route('/api/estudios', estudiosRouter);
app.route('/api/usuarios', usuariosRouter);
app.route('/api/clientes', clientesRouter);
app.route('/api/expedientes', expedientesRouter);
app.route('/api/documentos', documentosRouter);
app.route('/api/presupuestos', presupuestosRouter);
app.route('/api/estrategias', estrategiasRouter);
app.route('/api/actuaciones', actuacionesRouter);
app.route('/api/templates', templatesRouter);
app.route('/api/audiencias', audienciasRouter);
```

(El resto de `index.ts` — `onError` y `GET /api/salud` — queda igual.)

Nota: en este paso `estudiosRouter` todavía se monta sin `requireAuth` (queda así intencionalmente, ver spec) y los routers de datos (`usuariosRouter`, `clientesRouter`, etc.) todavía NO tienen `requireAuth` montado — eso es Task 5, junto con el cambio de `estudio_id`. Hasta terminar Task 5, esos routers siguen abiertos; es un estado intermedio esperado dentro del mismo trabajo, no se despliega a producción entre tasks.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sin errores — `authRouter` es el único router nuevo tipado con `Env`,
y se monta con `app.route('/api/auth', authRouter)` sobre un `app` que solo
pide `Bindings`, lo cual es válido. El resto de los routers (`usuariosRouter`,
`clientesRouter`, etc.) siguen sin `requireAuth` hasta Task 5; eso es el
estado intermedio esperado, no un error.

- [ ] **Step 4: Commit**

```bash
git add src/rutas/auth.ts src/index.ts
git commit -m "Agregar ruta whoami y montar auth router"
```

---

### Task 5: Aislamiento por `estudio_id` en todos los routers de datos

**Files:**
- Modify: `vindexapp-api/src/rutas/clientes.ts`
- Modify: `vindexapp-api/src/rutas/usuarios.ts`
- Modify: `vindexapp-api/src/rutas/expedientes.ts`
- Modify: `vindexapp-api/src/rutas/documentos.ts`
- Modify: `vindexapp-api/src/rutas/presupuestos.ts`
- Modify: `vindexapp-api/src/rutas/estrategias.ts`
- Modify: `vindexapp-api/src/rutas/actuaciones.ts`
- Modify: `vindexapp-api/src/rutas/audiencias.ts`
- Modify: `vindexapp-api/src/rutas/templates.ts`
- Create: `vindexapp-api/src/rutas/aislamiento.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `Env` (Task 3/4).
- Produces: ninguna interfaz nueva — cierra el comportamiento que Task 6 y el frontend (Task 7) asumen (que el servidor nunca confía en un `estudio_id` de quien llama).

Este task toca 9 archivos con el mismo patrón (agregar `requireAuth`, tipar con `Env`, sacar `estudio_id` de query/body, usarlo desde `c.get('auth')`). Para que cada cambio sea revisable, se muestra el archivo resultante completo de cada router. Además, de paso, se cierran dos huecos de aislamiento que la lectura del código reveló y que el audit original no había señalado porque no eran endpoints "sin filtro" sino endpoints que confiaban en un `expediente_id`/`presupuesto_id` ajeno sin validar que perteneciera al estudio del que llama (`estrategias.ts` POST/GET, `actuaciones.ts` POST/GET, `presupuestos.ts` `/firmar`).

- [ ] **Step 1: Escribir el test de aislamiento cruzado (falla primero)**

Crear `src/rutas/aislamiento.test.ts`. Cubre representativamente los 9 routers: los 6 endpoints que el audit marcó, más los dos huecos encontrados en `estrategias`/`presupuestos` durante este mismo trabajo.

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import app from '../index';

let jwksDePrueba: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const par = await generateKeyPair('RS256');
  privateKey = par.privateKey;
  const jwk = await exportJWK(par.publicKey);
  jwk.kid = 'clave-de-prueba';
  jwksDePrueba = createLocalJWKSet({ keys: [jwk] });

  // Nota: requireAuth() sin argumentos usa obtenerJWKS (remoto). Para que
  // este test de extremo a extremo autentique sin red, se registra un
  // usuario y se firma un token contra el AUD de prueba de
  // vitest.config.ts; el JWKS remoto real no se usa porque el conjunto de
  // pruebas apunta a env.ACCESS_TEAM_DOMINIO = 'equipo-de-prueba', que no
  // existe: por eso este archivo NO puede usar app.request con
  // requireAuth() real. En su lugar, cada test llama directamente a
  // app.request con el header Cf-Access-Jwt-Assertion y confía en que
  // Cloudflare Access, en producción, es quien low agrega — acá se firma
  // con la misma clave que expone /cdn-cgi/access/certs simulado vía
  // createLocalJWKSet, y se inyecta con --- ver Step 2.
});
```

Al llegar a este punto conviene notar algo: `app` (el Hono completo montado en `src/index.ts`) usa `requireAuth()` con el resolver remoto real (`obtenerJWKS`), que intenta pegarle por HTTP a `https://equipo-de-prueba.cloudflareaccess.com/...` — inalcanzable en test. Probar aislamiento a través de la app completa requeriría mockear ese fetch. Para mantener el test simple y determinístico, se prueba el aislamiento **por router**, montando cada router sobre una app de test con `requireAuth(() => jwksDePrueba)` (mismo patrón que `auth.integration.test.ts`), en lugar de importar `app` de `index.ts`. Reemplazar el archivo completo por:

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';
import { clientesRouter } from './clientes';
import { usuariosRouter } from './usuarios';
import { estrategiasRouter } from './estrategias';
import { actuacionesRouter } from './actuaciones';
import { presupuestosRouter } from './presupuestos';
import { audienciasRouter } from './audiencias';

let jwksDePrueba: JWTVerifyGetKey;
let privateKey: CryptoKey;

const ESTUDIO_A = 'estudio-aislamiento-a';
const ESTUDIO_B = 'estudio-aislamiento-b';

beforeAll(async () => {
  const par = await generateKeyPair('RS256');
  privateKey = par.privateKey;
  const jwk = await exportJWK(par.publicKey);
  jwk.kid = 'clave-de-prueba';
  jwksDePrueba = createLocalJWKSet({ keys: [jwk] });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO estudios (id, nombre, creado_en, activo) VALUES (?, 'Estudio A', 0, 1)`
    ).bind(ESTUDIO_A),
    env.DB.prepare(
      `INSERT INTO estudios (id, nombre, creado_en, activo) VALUES (?, 'Estudio B', 0, 1)`
    ).bind(ESTUDIO_B),
    env.DB.prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES ('usuario-a', ?, 'Lucia', 'Perez', 'lucia@vindexlegal.com.ar', 'titular', 1, 0)`
    ).bind(ESTUDIO_A),
  ]);
});

async function tokenComoUsuarioA() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: 'lucia@vindexlegal.com.ar' })
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience('aud-de-prueba')
    .setExpirationTime(ahora + 300)
    .sign(privateKey);
}

function montar(router: Hono<Env>) {
  const app = new Hono<Env>();
  app.use('*', requireAuth(() => jwksDePrueba));
  app.route('/', router);
  return app;
}

async function pedidoComoUsuarioA(router: Hono<Env>, path: string, init?: RequestInit) {
  const token = await tokenComoUsuarioA();
  const app = montar(router);
  return app.request(
    path,
    { ...init, headers: { ...(init?.headers ?? {}), 'Cf-Access-Jwt-Assertion': token } },
    env
  );
}

describe('aislamiento por estudio_id', () => {
  it('clientes: GET /:id no devuelve un cliente de otro estudio', async () => {
    await env.DB.prepare(
      `INSERT INTO clientes (id, estudio_id, nombre, apellido, estado, creado_en)
       VALUES ('cliente-b', ?, 'Marcos', 'Diaz', 'Activo', 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(clientesRouter, '/cliente-b');

    expect(res.status).toBe(404);
  });

  it('clientes: GET / no acepta estudio_id de otro estudio por query', async () => {
    const res = await pedidoComoUsuarioA(clientesRouter, `/?estudio_id=${ESTUDIO_B}`);
    const cuerpo = await res.json<Array<{ id: string }>>();

    expect(cuerpo.find((c) => c.id === 'cliente-b')).toBeUndefined();
  });

  it('usuarios: GET / sin query devuelve solo el propio estudio, nunca todos', async () => {
    await env.DB.prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES ('usuario-b', ?, 'Otro', 'Estudio', 'otro@vindexlegal.com.ar', 'titular', 1, 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(usuariosRouter, '/');
    const cuerpo = await res.json<Array<{ id: string }>>();

    expect(cuerpo.find((u) => u.id === 'usuario-b')).toBeUndefined();
  });

  it('estrategias: POST rechaza un expediente_id de otro estudio', async () => {
    await env.DB.prepare(
      `INSERT INTO clientes (id, estudio_id, nombre, apellido, estado, creado_en)
       VALUES ('cliente-para-expediente-b', ?, 'X', 'Y', 'Activo', 0)`
    )
      .bind(ESTUDIO_B)
      .run();
    await env.DB.prepare(
      `INSERT INTO expedientes (id, estudio_id, cliente_id, caratula, estado, creado_en)
       VALUES ('expediente-b', ?, 'cliente-para-expediente-b', 'Causa B', 'En tramite', 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(estrategiasRouter, '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expediente_id: 'expediente-b', titulo: 'Intento cruzado' }),
    });

    expect(res.status).toBe(404);
  });

  it('estrategias: PATCH /:id no actualiza una estrategia de otro estudio', async () => {
    await env.DB.prepare(
      `INSERT INTO estrategias (id, estudio_id, expediente_id, titulo, creado_en)
       VALUES ('estrategia-b', ?, 'expediente-b', 'Original', 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(estrategiasRouter, '/estrategia-b', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: 'Hackeado' }),
    });

    expect(res.status).toBe(404);

    const fila = await env.DB.prepare('SELECT titulo FROM estrategias WHERE id = ?')
      .bind('estrategia-b')
      .first<{ titulo: string }>();
    expect(fila?.titulo).toBe('Original');
  });

  it('actuaciones: PATCH /:id/notificar no toca una actuacion de otro estudio', async () => {
    await env.DB.prepare(
      `INSERT INTO actuaciones (id, estudio_id, expediente_id, tipo, fecha, notificado, creado_en)
       VALUES ('actuacion-b', ?, 'expediente-b', 'Providencia', '2026-08-01', 0, 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(actuacionesRouter, '/actuacion-b/notificar', {
      method: 'PATCH',
    });

    expect(res.status).toBe(404);
  });

  it('presupuestos: PATCH /:id/estado no cambia un presupuesto de otro estudio', async () => {
    await env.DB.prepare(
      `INSERT INTO presupuestos (id, estudio_id, contacto_nombre, concepto, monto, estado, creado_en)
       VALUES ('presupuesto-b', ?, 'Contacto B', 'Consulta', 10000, 'borrador', 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(presupuestosRouter, '/presupuesto-b/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'enviado' }),
    });

    expect(res.status).toBe(404);
  });

  it('presupuestos: PATCH /:id/firmar no firma un presupuesto de otro estudio', async () => {
    const res = await pedidoComoUsuarioA(presupuestosRouter, '/presupuesto-b/firmar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expediente_id: 'expediente-b' }),
    });

    expect(res.status).toBe(404);
  });

  it('audiencias: PATCH /:id/estado no cambia una audiencia de otro estudio', async () => {
    await env.DB.prepare(
      `INSERT INTO audiencias (id, estudio_id, expediente_id, tipo, fecha, estado, recordatorio, creado_en)
       VALUES ('audiencia-b', ?, 'expediente-b', 'Vista de causa', '2026-09-01', 'Programada', 1, 0)`
    )
      .bind(ESTUDIO_B)
      .run();

    const res = await pedidoComoUsuarioA(audienciasRouter, '/audiencia-b/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'Realizada' }),
    });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- aislamiento.test`
Expected: FAIL en la mayoría — los routers todavía no montan `requireAuth`, así que `c.get('auth')` es `undefined` y las rutas revientan o devuelven datos de cualquier estudio.

- [ ] **Step 3: Reescribir `src/rutas/clientes.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const clientesRouter = new Hono<Env>();

clientesRouter.use('*', requireAuth());

clientesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    nombre: string;
    apellido: string;
    dni?: string;
    domicilio?: string;
    localidad?: string;
    telefono_fijo?: string;
    whatsapp?: string;
    email?: string;
    estado?: 'Activo' | 'Potencial' | 'Inactivo';
    notas?: string;
  }>();

  if (!body.nombre || !body.apellido) {
    return c.json({ error: 'nombre y apellido son obligatorios.' }, 400);
  }

  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id, nombre, apellido FROM clientes WHERE estudio_id = ? AND dni = ?'
    )
      .bind(auth.estudio_id, body.dni)
      .first<{ id: string; nombre: string; apellido: string }>();

    if (existente) {
      return c.json(
        { error: 'Ya existe un cliente con ese DNI.', cliente_existente: existente },
        409
      );
    }
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  try {
    await c.env.DB.prepare(
      `INSERT INTO clientes
        (id, estudio_id, nombre, apellido, dni, domicilio, localidad, telefono_fijo, whatsapp, email, estado, notas, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        auth.estudio_id,
        body.nombre,
        body.apellido,
        body.dni ?? null,
        body.domicilio ?? null,
        body.localidad ?? null,
        body.telefono_fijo ?? null,
        body.whatsapp ?? null,
        body.email ?? null,
        body.estado ?? 'Activo',
        body.notas ?? null,
        creado_en
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un cliente con ese DNI.' }, 409);
    }
    throw err;
  }

  return c.json({ id, nombre: body.nombre, apellido: body.apellido }, 201);
});

clientesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const dni = c.req.query('dni');

  const query = dni
    ? c.env.DB.prepare('SELECT * FROM clientes WHERE estudio_id = ? AND dni = ?').bind(
        auth.estudio_id,
        dni
      )
    : c.env.DB.prepare('SELECT * FROM clientes WHERE estudio_id = ? ORDER BY apellido, nombre').bind(
        auth.estudio_id
      );

  const { results } = await query.all();
  return c.json(results);
});

/** Un cliente puntual. */
clientesRouter.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const cliente = await c.env.DB.prepare(
    'SELECT * FROM clientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!cliente) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  return c.json(cliente);
});
```

- [ ] **Step 4: Reescribir `src/rutas/usuarios.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const usuariosRouter = new Hono<Env>();

usuariosRouter.use('*', requireAuth());

const ROLES_VALIDOS = ['titular', 'asociado', 'administrativo'] as const;
type Rol = (typeof ROLES_VALIDOS)[number];

usuariosRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    nombre: string;
    apellido: string;
    dni?: string;
    domicilio?: string;
    localidad?: string;
    telefono_fijo?: string;
    whatsapp?: string;
    email: string;
    rol: Rol;
  }>();

  if (!body.nombre || !body.apellido || !body.email || !body.rol) {
    return c.json({ error: 'nombre, apellido, email y rol son obligatorios.' }, 400);
  }

  if (!ROLES_VALIDOS.includes(body.rol)) {
    return c.json({ error: `rol debe ser uno de: ${ROLES_VALIDOS.join(', ')}` }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  try {
    await c.env.DB.prepare(
      `INSERT INTO usuarios
        (id, estudio_id, nombre, apellido, dni, domicilio, localidad, telefono_fijo, whatsapp, email, rol, activo, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        id,
        auth.estudio_id,
        body.nombre,
        body.apellido,
        body.dni ?? null,
        body.domicilio ?? null,
        body.localidad ?? null,
        body.telefono_fijo ?? null,
        body.whatsapp ?? null,
        body.email,
        body.rol,
        creado_en
      )
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'No se pudo crear el usuario. ¿El email ya está en uso?' }, 409);
    }
    throw err;
  }

  return c.json({ id, nombre: body.nombre, apellido: body.apellido, email: body.email }, 201);
});

usuariosRouter.get('/', async (c) => {
  const auth = c.get('auth');

  const { results } = await c.env.DB.prepare(
    `SELECT id, estudio_id, nombre, apellido, dni, email, rol, activo, creado_en
     FROM usuarios WHERE estudio_id = ? ORDER BY apellido, nombre`
  )
    .bind(auth.estudio_id)
    .all();

  return c.json(results);
});
```

- [ ] **Step 5: Reescribir `src/rutas/expedientes.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const expedientesRouter = new Hono<Env>();

expedientesRouter.use('*', requireAuth());

expedientesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    cliente_id: string;
    caratula: string;
    numero?: string;
    fuero?: string;
    juzgado?: string;
    departamento?: string;
    rol_procesal?: string;
    inicio?: string;
    notas?: string;
  }>();

  if (!body.cliente_id || !body.caratula) {
    return c.json({ error: 'cliente_id y caratula son obligatorios.' }, 400);
  }

  const cliente = await c.env.DB.prepare(
    'SELECT id FROM clientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.cliente_id, auth.estudio_id)
    .first();

  if (!cliente) {
    return c.json({ error: 'El cliente no existe o no pertenece a este estudio.' }, 404);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO expedientes
      (id, estudio_id, cliente_id, caratula, numero, fuero, juzgado, departamento, rol_procesal, estado, inicio, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'En trámite', ?, ?, ?)`
  )
    .bind(
      id,
      auth.estudio_id,
      body.cliente_id,
      body.caratula,
      body.numero ?? null,
      body.fuero ?? null,
      body.juzgado ?? null,
      body.departamento ?? null,
      body.rol_procesal ?? null,
      body.inicio ?? null,
      body.notas ?? null,
      creado_en
    )
    .run();

  return c.json({ id, caratula: body.caratula, cliente_id: body.cliente_id }, 201);
});

expedientesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const clienteId = c.req.query('cliente_id');

  const query = clienteId
    ? c.env.DB.prepare(
        `SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM expedientes e JOIN clientes c ON c.id = e.cliente_id
         WHERE e.estudio_id = ? AND e.cliente_id = ? ORDER BY e.creado_en DESC`
      ).bind(auth.estudio_id, clienteId)
    : c.env.DB.prepare(
        `SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
         FROM expedientes e JOIN clientes c ON c.id = e.cliente_id
         WHERE e.estudio_id = ? ORDER BY e.creado_en DESC`
      ).bind(auth.estudio_id);

  const { results } = await query.all();
  return c.json(results);
});

/** Un expediente puntual, con el nombre del cliente ya resuelto. */
expedientesRouter.get('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const expediente = await c.env.DB.prepare(
    `SELECT e.*, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido
     FROM expedientes e JOIN clientes c ON c.id = e.cliente_id
     WHERE e.id = ? AND e.estudio_id = ?`
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  return c.json(expediente);
});
```

- [ ] **Step 6: Reescribir `src/rutas/documentos.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const documentosRouter = new Hono<Env>();

documentosRouter.use('*', requireAuth());

const CATEGORIAS_VALIDAS = [
  'escrito_judicial', 'resolucion', 'presupuesto', 'estrategia',
  'planilla', 'template', 'factura', 'captura', 'otro',
] as const;

documentosRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.parseBody();
  const archivo = body['archivo'];

  if (!(archivo instanceof File)) {
    return c.json({ error: 'Falta el archivo (campo "archivo").' }, 400);
  }

  const categoria = body['categoria'] as string | undefined;

  if (!categoria) {
    return c.json({ error: 'categoria es obligatoria.' }, 400);
  }

  if (!CATEGORIAS_VALIDAS.includes(categoria as (typeof CATEGORIAS_VALIDAS)[number])) {
    return c.json({ error: `categoria debe ser una de: ${CATEGORIAS_VALIDAS.join(', ')}` }, 400);
  }

  const cliente_id = (body['cliente_id'] as string) || null;
  const expediente_id = (body['expediente_id'] as string) || null;
  const notas = (body['notas'] as string) || null;

  const id = crypto.randomUUID();
  const extension = archivo.name.includes('.')
    ? archivo.name.split('.').pop()!.toLowerCase()
    : 'sin_extension';
  const ruta_r2 = `${auth.estudio_id}/${id}.${extension}`;
  const creado_en = Date.now();

  await c.env.DOCUMENTOS.put(ruta_r2, await archivo.arrayBuffer(), {
    httpMetadata: { contentType: archivo.type || 'application/octet-stream' },
  });

  await c.env.DB.prepare(
    `INSERT INTO documentos
      (id, estudio_id, cliente_id, expediente_id, categoria, nombre, extension, ruta_r2, tamano_bytes, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, auth.estudio_id, cliente_id, expediente_id, categoria,
      archivo.name, extension, ruta_r2, archivo.size, notas, creado_en
    )
    .run();

  return c.json({ id, nombre: archivo.name, categoria, tamano_bytes: archivo.size }, 201);
});

documentosRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  const clienteId = c.req.query('cliente_id');

  let sql = 'SELECT id, categoria, nombre, extension, tamano_bytes, notas, creado_en FROM documentos WHERE estudio_id = ?';
  const params: string[] = [auth.estudio_id];

  if (expedienteId) {
    sql += ' AND expediente_id = ?';
    params.push(expedienteId);
  } else if (clienteId) {
    sql += ' AND cliente_id = ?';
    params.push(clienteId);
  }
  sql += ' ORDER BY creado_en DESC';

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

/** Descarga el archivo real, transmitido a través del Worker. */
documentosRouter.get('/:id/descargar', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const doc = await c.env.DB.prepare(
    'SELECT nombre, ruta_r2 FROM documentos WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first<{ nombre: string; ruta_r2: string }>();

  if (!doc) {
    return c.json({ error: 'Documento no encontrado.' }, 404);
  }

  const objeto = await c.env.DOCUMENTOS.get(doc.ruta_r2);
  if (!objeto) {
    return c.json({ error: 'El archivo no existe en el almacenamiento.' }, 404);
  }

  c.header('Content-Disposition', `attachment; filename="${doc.nombre}"`);
  return c.body(objeto.body);
});
```

- [ ] **Step 7: Reescribir `src/rutas/presupuestos.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const presupuestosRouter = new Hono<Env>();

presupuestosRouter.use('*', requireAuth());

presupuestosRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    cliente_id?: string;
    contacto_nombre?: string;
    contacto_telefono?: string;
    concepto: string;
    monto: number;
  }>();

  if (!body.concepto || body.monto === undefined) {
    return c.json({ error: 'concepto y monto son obligatorios.' }, 400);
  }
  if (!body.cliente_id && !body.contacto_nombre) {
    return c.json(
      { error: 'Falta cliente_id (cliente existente) o contacto_nombre (potencial cliente).' },
      400
    );
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO presupuestos
      (id, estudio_id, cliente_id, contacto_nombre, contacto_telefono, concepto, monto, estado, fecha_emision, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?)`
  )
    .bind(
      id, auth.estudio_id, body.cliente_id ?? null, body.contacto_nombre ?? null,
      body.contacto_telefono ?? null, body.concepto, body.monto,
      new Date(creado_en).toISOString().slice(0, 10), creado_en
    )
    .run();

  return c.json({ id, estado: 'borrador' }, 201);
});

presupuestosRouter.get('/', async (c) => {
  const auth = c.get('auth');

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM presupuestos WHERE estudio_id = ? ORDER BY creado_en DESC'
  )
    .bind(auth.estudio_id)
    .all();

  return c.json(results);
});

/** Cambia el estado (enviado / rechazado / vencido) — transicion simple. */
presupuestosRouter.patch('/:id/estado', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const { estado } = await c.req.json<{ estado: string }>();

  if (!['enviado', 'rechazado', 'vencido'].includes(estado)) {
    return c.json({ error: 'estado inválido. Usá /firmar para la firma.' }, 400);
  }

  const existente = await c.env.DB.prepare(
    'SELECT id FROM presupuestos WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!existente) {
    return c.json({ error: 'Presupuesto no encontrado.' }, 404);
  }

  await c.env.DB.prepare('UPDATE presupuestos SET estado = ? WHERE id = ?').bind(estado, id).run();

  return c.json({ id, estado });
});

/**
 * Firma del presupuesto: transicion especial. Si todavia no existe el
 * cliente (era un potencial cliente por contacto_nombre), lo crea aca.
 * Requiere el expediente_id ya creado (se abre por separado, en
 * /api/expedientes, y se vincula aca).
 */
presupuestosRouter.patch('/:id/firmar', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{
    expediente_id: string;
    nombre?: string;
    apellido?: string;
    dni?: string;
  }>();

  const presupuesto = await c.env.DB.prepare(
    'SELECT * FROM presupuestos WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first<{
      estudio_id: string;
      cliente_id: string | null;
      contacto_telefono: string | null;
      estado: string;
    }>();

  if (!presupuesto) return c.json({ error: 'Presupuesto no encontrado.' }, 404);
  if (presupuesto.estado === 'firmado') {
    return c.json({ error: 'Este presupuesto ya está firmado.' }, 409);
  }
  if (!body.expediente_id) {
    return c.json({ error: 'expediente_id es obligatorio para firmar.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.expediente_id, auth.estudio_id)
    .first();

  if (!expediente) {
    return c.json({ error: 'El expediente no existe o no pertenece a este estudio.' }, 404);
  }

  let clienteId = presupuesto.cliente_id;

  if (!clienteId) {
    if (!body.nombre || !body.apellido) {
      return c.json(
        { error: 'Es un presupuesto sin cliente formal: nombre y apellido son obligatorios para darlo de alta.' },
        400
      );
    }
    clienteId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO clientes (id, estudio_id, nombre, apellido, dni, telefono_fijo, estado, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'Activo', ?)`
    )
      .bind(
        clienteId, auth.estudio_id, body.nombre, body.apellido,
        body.dni ?? null, presupuesto.contacto_telefono ?? null, Date.now()
      )
      .run();
  }

  const fecha_firma = new Date().toISOString().slice(0, 10);

  await c.env.DB.prepare(
    `UPDATE presupuestos
     SET estado = 'firmado', cliente_id = ?, expediente_id = ?, fecha_firma = ?
     WHERE id = ?`
  )
    .bind(clienteId, body.expediente_id, fecha_firma, id)
    .run();

  return c.json({ id, estado: 'firmado', cliente_id: clienteId, expediente_id: body.expediente_id });
});
```

- [ ] **Step 8: Reescribir `src/rutas/estrategias.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const estrategiasRouter = new Hono<Env>();

estrategiasRouter.use('*', requireAuth());

estrategiasRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    expediente_id: string;
    titulo: string;
    contenido?: string;
  }>();

  if (!body.expediente_id || !body.titulo) {
    return c.json({ error: 'expediente_id y titulo son obligatorios.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.expediente_id, auth.estudio_id)
    .first();

  if (!expediente) {
    return c.json({ error: 'El expediente no existe o no pertenece a este estudio.' }, 404);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO estrategias (id, estudio_id, expediente_id, titulo, contenido, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, auth.estudio_id, body.expediente_id, body.titulo, body.contenido ?? null, auth.usuario_id, creado_en)
    .run();

  return c.json({ id, titulo: body.titulo }, 201);
});

estrategiasRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM estrategias WHERE expediente_id = ? AND estudio_id = ? ORDER BY creado_en DESC'
  )
    .bind(expedienteId, auth.estudio_id)
    .all();

  return c.json(results);
});

estrategiasRouter.patch('/:id', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const { titulo, contenido } = await c.req.json<{ titulo?: string; contenido?: string }>();

  const existente = await c.env.DB.prepare(
    'SELECT id FROM estrategias WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!existente) {
    return c.json({ error: 'Estrategia no encontrada.' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE estrategias SET titulo = COALESCE(?, titulo), contenido = COALESCE(?, contenido), actualizado_en = ? WHERE id = ?'
  )
    .bind(titulo ?? null, contenido ?? null, Date.now(), id)
    .run();

  return c.json({ id, actualizado: true });
});
```

- [ ] **Step 9: Reescribir `src/rutas/actuaciones.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const actuacionesRouter = new Hono<Env>();

actuacionesRouter.use('*', requireAuth());

actuacionesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    expediente_id: string;
    tipo: string;
    fecha: string;
    detalle_interno?: string;
    texto_cliente?: string;
    visible?: boolean;
    hito?: boolean;
  }>();

  if (!body.expediente_id || !body.tipo || !body.fecha) {
    return c.json({ error: 'expediente_id, tipo y fecha son obligatorios.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.expediente_id, auth.estudio_id)
    .first();

  if (!expediente) {
    return c.json({ error: 'El expediente no existe o no pertenece a este estudio.' }, 404);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO actuaciones
      (id, estudio_id, expediente_id, tipo, fecha, detalle_interno, texto_cliente, visible, hito, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, auth.estudio_id, body.expediente_id, body.tipo, body.fecha,
      body.detalle_interno ?? null, body.texto_cliente ?? null,
      body.visible ? 1 : 0, body.hito ? 1 : 0, auth.usuario_id, creado_en
    )
    .run();

  return c.json({ id, tipo: body.tipo, fecha: body.fecha }, 201);
});

actuacionesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');
  if (!expedienteId) return c.json({ error: 'expediente_id es obligatorio.' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM actuaciones WHERE expediente_id = ? AND estudio_id = ? ORDER BY fecha DESC, creado_en DESC'
  )
    .bind(expedienteId, auth.estudio_id)
    .all();

  return c.json(results);
});

/** Marca una actuacion como notificada/publicada al cliente. */
actuacionesRouter.patch('/:id/notificar', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');

  const existente = await c.env.DB.prepare(
    'SELECT id FROM actuaciones WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!existente) {
    return c.json({ error: 'Actuación no encontrada.' }, 404);
  }

  await c.env.DB.prepare('UPDATE actuaciones SET notificado = 1, visible = 1 WHERE id = ?')
    .bind(id)
    .run();

  return c.json({ id, notificado: true });
});
```

- [ ] **Step 10: Reescribir `src/rutas/audiencias.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const audienciasRouter = new Hono<Env>();

audienciasRouter.use('*', requireAuth());

const MODALIDADES_VALIDAS = ['Presencial', 'Videoconferencia', 'Telefónica'] as const;
const ESTADOS_VALIDOS = ['Programada', 'Realizada', 'Suspendida', 'Cancelada'] as const;

audienciasRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    expediente_id: string;
    tipo: string;
    fecha: string;
    hora?: string;
    modalidad?: (typeof MODALIDADES_VALIDAS)[number];
    lugar?: string;
    recordatorio?: boolean;
  }>();

  if (!body.expediente_id || !body.tipo || !body.fecha) {
    return c.json({ error: 'expediente_id, tipo y fecha son obligatorios.' }, 400);
  }

  if (body.modalidad && !MODALIDADES_VALIDAS.includes(body.modalidad)) {
    return c.json({ error: `modalidad debe ser una de: ${MODALIDADES_VALIDAS.join(', ')}` }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(body.expediente_id, auth.estudio_id)
    .first();

  if (!expediente) {
    return c.json({ error: 'El expediente no existe o no pertenece a este estudio.' }, 404);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO audiencias
      (id, estudio_id, expediente_id, tipo, fecha, hora, modalidad, lugar, estado, recordatorio, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Programada', ?, ?)`
  )
    .bind(
      id, auth.estudio_id, body.expediente_id, body.tipo, body.fecha,
      body.hora ?? null, body.modalidad ?? null, body.lugar ?? null,
      body.recordatorio === false ? 0 : 1, creado_en
    )
    .run();

  return c.json({ id, tipo: body.tipo, fecha: body.fecha, estado: 'Programada' }, 201);
});

audienciasRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const expedienteId = c.req.query('expediente_id');

  const query = expedienteId
    ? c.env.DB.prepare(
        'SELECT * FROM audiencias WHERE expediente_id = ? AND estudio_id = ? ORDER BY fecha, hora'
      ).bind(expedienteId, auth.estudio_id)
    : c.env.DB.prepare('SELECT * FROM audiencias WHERE estudio_id = ? ORDER BY fecha, hora').bind(
        auth.estudio_id
      );

  const { results } = await query.all();
  return c.json(results);
});

/** Cambia el estado de la audiencia (Realizada / Suspendida / Cancelada). */
audienciasRouter.patch('/:id/estado', async (c) => {
  const auth = c.get('auth');
  const id = c.req.param('id');
  const { estado } = await c.req.json<{ estado: string }>();

  if (!ESTADOS_VALIDOS.includes(estado as (typeof ESTADOS_VALIDOS)[number])) {
    return c.json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` }, 400);
  }

  const existente = await c.env.DB.prepare(
    'SELECT id FROM audiencias WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, auth.estudio_id)
    .first();

  if (!existente) {
    return c.json({ error: 'Audiencia no encontrada.' }, 404);
  }

  await c.env.DB.prepare('UPDATE audiencias SET estado = ? WHERE id = ?').bind(estado, id).run();

  return c.json({ id, estado });
});
```

- [ ] **Step 11: Reescribir `src/rutas/templates.ts`**

```ts
import { Hono } from 'hono';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';

export const templatesRouter = new Hono<Env>();

templatesRouter.use('*', requireAuth());

templatesRouter.post('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    nombre: string;
    categoria?: string;
    documento_id?: string;
  }>();

  if (!body.nombre) {
    return c.json({ error: 'nombre es obligatorio.' }, 400);
  }

  const id = crypto.randomUUID();
  const creado_en = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO templates (id, estudio_id, nombre, categoria, documento_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, auth.estudio_id, body.nombre, body.categoria ?? null, body.documento_id ?? null, creado_en)
    .run();

  return c.json({ id, nombre: body.nombre }, 201);
});

templatesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const categoria = c.req.query('categoria');

  const query = categoria
    ? c.env.DB.prepare(
        'SELECT * FROM templates WHERE estudio_id = ? AND categoria = ? ORDER BY nombre'
      ).bind(auth.estudio_id, categoria)
    : c.env.DB.prepare('SELECT * FROM templates WHERE estudio_id = ? ORDER BY nombre').bind(
        auth.estudio_id
      );

  const { results } = await query.all();
  return c.json(results);
});
```

- [ ] **Step 12: Correr todos los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — incluye `aislamiento.test.ts` y todo lo de Task 3.

- [ ] **Step 13: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 14: Commit**

```bash
git add src/rutas/clientes.ts src/rutas/usuarios.ts src/rutas/expedientes.ts src/rutas/documentos.ts src/rutas/presupuestos.ts src/rutas/estrategias.ts src/rutas/actuaciones.ts src/rutas/audiencias.ts src/rutas/templates.ts src/rutas/aislamiento.test.ts
git commit -m "Cerrar aislamiento por estudio_id en todos los routers de datos"
```

---

### Task 6: Log de auditoría en expedientes y documentos

**Files:**
- Create: `vindexapp-api/src/db/auditoria.ts`
- Create: `vindexapp-api/src/db/auditoria.test.ts`
- Modify: `vindexapp-api/src/rutas/expedientes.ts`
- Modify: `vindexapp-api/src/rutas/documentos.ts`

**Interfaces:**
- Consumes: `AuthContext` (Task 3), tabla `auditoria` (Task 2).
- Produces: `function registrarAuditoria(db: D1Database, auth: AuthContext, datos: { entidad: 'expediente' | 'documento'; entidad_id: string; accion: 'crear' | 'actualizar' | 'eliminar'; detalle?: Record<string, unknown> }): Promise<void>`.

- [ ] **Step 1: Escribir el test del helper (falla primero)**

Crear `src/db/auditoria.test.ts`:

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { registrarAuditoria } from './auditoria';
import type { AuthContext } from '../middleware/auth';

const AUTH: AuthContext = {
  usuario_id: 'usuario-auditoria',
  estudio_id: 'estudio-auditoria',
  rol: 'titular',
  email: 'auditoria@vindexlegal.com.ar',
};

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO estudios (id, nombre, creado_en, activo) VALUES (?, 'Estudio Auditoria', 0, 1)`
    ).bind(AUTH.estudio_id),
    env.DB.prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES (?, ?, 'Ana', 'Gomez', ?, 'titular', 1, 0)`
    ).bind(AUTH.usuario_id, AUTH.estudio_id, AUTH.email),
  ]);
});

describe('registrarAuditoria', () => {
  it('inserta una fila con los datos correctos', async () => {
    await registrarAuditoria(env.DB, AUTH, {
      entidad: 'expediente',
      entidad_id: 'expediente-auditado',
      accion: 'crear',
    });

    const fila = await env.DB.prepare(
      'SELECT estudio_id, usuario_id, entidad, entidad_id, accion FROM auditoria WHERE entidad_id = ?'
    )
      .bind('expediente-auditado')
      .first();

    expect(fila).toEqual({
      estudio_id: AUTH.estudio_id,
      usuario_id: AUTH.usuario_id,
      entidad: 'expediente',
      entidad_id: 'expediente-auditado',
      accion: 'crear',
    });
  });

  it('guarda el detalle como JSON cuando se provee', async () => {
    await registrarAuditoria(env.DB, AUTH, {
      entidad: 'documento',
      entidad_id: 'documento-auditado',
      accion: 'crear',
      detalle: { nombre: 'contrato.pdf' },
    });

    const fila = await env.DB.prepare('SELECT detalle FROM auditoria WHERE entidad_id = ?')
      .bind('documento-auditado')
      .first<{ detalle: string }>();

    expect(JSON.parse(fila!.detalle)).toEqual({ nombre: 'contrato.pdf' });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- auditoria.test`
Expected: FAIL — `src/db/auditoria.ts` no existe.

- [ ] **Step 3: Implementar `src/db/auditoria.ts`**

```ts
import type { AuthContext } from '../middleware/auth';

type EntidadAuditable = 'expediente' | 'documento';
type AccionAuditable = 'crear' | 'actualizar' | 'eliminar';

export async function registrarAuditoria(
  db: D1Database,
  auth: AuthContext,
  datos: {
    entidad: EntidadAuditable;
    entidad_id: string;
    accion: AccionAuditable;
    detalle?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auditoria (id, estudio_id, usuario_id, entidad, entidad_id, accion, detalle, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      auth.estudio_id,
      auth.usuario_id,
      datos.entidad,
      datos.entidad_id,
      datos.accion,
      datos.detalle ? JSON.stringify(datos.detalle) : null,
      Date.now()
    )
    .run();
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test -- auditoria.test`
Expected: PASS.

- [ ] **Step 5: Wirear en `expedientesRouter.post('/')`**

En `src/rutas/expedientes.ts`, agregar el import y la llamada después del `INSERT`:

Agregar el import al principio del archivo:

```ts
import { registrarAuditoria } from '../db/auditoria';
```

Y en `expedientesRouter.post('/')`, reemplazar el bloque final (desde el
`INSERT` hasta el `return`) por:

```ts
  await c.env.DB.prepare(
    `INSERT INTO expedientes
      (id, estudio_id, cliente_id, caratula, numero, fuero, juzgado, departamento, rol_procesal, estado, inicio, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'En trámite', ?, ?, ?)`
  )
    .bind(
      id,
      auth.estudio_id,
      body.cliente_id,
      body.caratula,
      body.numero ?? null,
      body.fuero ?? null,
      body.juzgado ?? null,
      body.departamento ?? null,
      body.rol_procesal ?? null,
      body.inicio ?? null,
      body.notas ?? null,
      creado_en
    )
    .run();

  await registrarAuditoria(c.env.DB, auth, {
    entidad: 'expediente',
    entidad_id: id,
    accion: 'crear',
    detalle: { caratula: body.caratula, cliente_id: body.cliente_id },
  });

  return c.json({ id, caratula: body.caratula, cliente_id: body.cliente_id }, 201);
```

- [ ] **Step 6: Wirear en `documentosRouter.post('/')`**

En `src/rutas/documentos.ts`, mismo patrón:

Agregar el import al principio del archivo:

```ts
import { registrarAuditoria } from '../db/auditoria';
```

Y en `documentosRouter.post('/')`, reemplazar el bloque final (desde el
`INSERT` hasta el `return`) por:

```ts
  await c.env.DB.prepare(
    `INSERT INTO documentos
      (id, estudio_id, cliente_id, expediente_id, categoria, nombre, extension, ruta_r2, tamano_bytes, notas, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id, auth.estudio_id, cliente_id, expediente_id, categoria,
      archivo.name, extension, ruta_r2, archivo.size, notas, creado_en
    )
    .run();

  await registrarAuditoria(c.env.DB, auth, {
    entidad: 'documento',
    entidad_id: id,
    accion: 'crear',
    detalle: { nombre: archivo.name, categoria },
  });

  return c.json({ id, nombre: archivo.name, categoria, tamano_bytes: archivo.size }, 201);
```

- [ ] **Step 7: Agregar tests de integración de que el wiring quedó conectado**

Agregar a `src/rutas/aislamiento.test.ts` (o crear `src/rutas/auditoria.integration.test.ts` — usar este segundo nombre, para no mezclar con los tests de aislamiento):

```ts
import { describe, expect, it, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import type { Env } from '../tipos';
import { requireAuth } from '../middleware/auth';
import { expedientesRouter } from './expedientes';

let jwksDePrueba: JWTVerifyGetKey;
let privateKey: CryptoKey;

beforeAll(async () => {
  const par = await generateKeyPair('RS256');
  privateKey = par.privateKey;
  const jwk = await exportJWK(par.publicKey);
  jwk.kid = 'clave-de-prueba';
  jwksDePrueba = createLocalJWKSet({ keys: [jwk] });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO estudios (id, nombre, creado_en, activo) VALUES ('estudio-auditoria-integ', 'Estudio', 0, 1)`
    ),
    env.DB.prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES ('usuario-auditoria-integ', 'estudio-auditoria-integ', 'Bea', 'Ruiz', 'bea@vindexlegal.com.ar', 'titular', 1, 0)`
    ),
    env.DB.prepare(
      `INSERT INTO clientes (id, estudio_id, nombre, apellido, estado, creado_en)
       VALUES ('cliente-auditoria-integ', 'estudio-auditoria-integ', 'Cliente', 'Test', 'Activo', 0)`
    ),
  ]);
});

async function token() {
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: 'bea@vindexlegal.com.ar' })
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience('aud-de-prueba')
    .setExpirationTime(ahora + 300)
    .sign(privateKey);
}

describe('auditoria en expedientes', () => {
  it('POST /expedientes deja una fila en auditoria', async () => {
    const app = new Hono<Env>();
    app.use('*', requireAuth(() => jwksDePrueba));
    app.route('/', expedientesRouter);

    const res = await app.request(
      '/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cf-Access-Jwt-Assertion': await token(),
        },
        body: JSON.stringify({ cliente_id: 'cliente-auditoria-integ', caratula: 'Causa auditada' }),
      },
      env
    );

    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    const fila = await env.DB.prepare(
      "SELECT accion, entidad FROM auditoria WHERE entidad_id = ? AND entidad = 'expediente'"
    )
      .bind(id)
      .first();

    expect(fila).toEqual({ accion: 'crear', entidad: 'expediente' });
  });
});
```

- [ ] **Step 8: Correr todos los tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add src/db/auditoria.ts src/db/auditoria.test.ts src/rutas/expedientes.ts src/rutas/documentos.ts src/rutas/auditoria.integration.test.ts
git commit -m "Agregar log de auditoria en altas de expediente y documento"
```

---

### Task 7: Frontend — sacar el `ESTUDIO_ID` hardcodeado y mostrar el usuario autenticado

**Files:**
- Modify: `vindexapp-frontend/src/api/http.ts`
- Modify: `vindexapp-frontend/src/api/cliente.ts`
- Modify: `vindexapp-frontend/src/api/expedientes.ts`
- Modify: `vindexapp-frontend/src/api/presupuestos.ts`
- Modify: `vindexapp-frontend/src/api/audiencias.ts`
- Create: `vindexapp-frontend/src/api/auth.ts`
- Modify: `vindexapp-frontend/src/componentes/Layout.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/whoami` (Task 4).
- Produces: `api.whoami(): Promise<{ usuario_id: string; nombre: string; apellido: string; estudio_id: string; rol: string }>` para quien lo necesite mostrar.

Este repo no tiene tests configurados todavía (no hay `package.json` con `vitest` ni nada equivalente) — verificación acá es manual, con `npm run build` y una revisión visual, no TDD.

- [ ] **Step 1: Sacar `ESTUDIO_ID` y agregar `credentials: 'include'` en `src/api/http.ts`**

```ts
const BASE_URL = 'http://localhost:8787/api';

export async function pedido<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE_URL}${ruta}`, {
    ...opciones,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opciones?.headers ?? {}) },
  });

  if (!resp.ok) {
    const cuerpo = await resp.json().catch(() => ({}));
    throw new Error(cuerpo.error ?? `Error ${resp.status} al llamar a ${ruta}`);
  }

  return resp.json();
}
```

- [ ] **Step 2: Actualizar `src/api/cliente.ts`**

```ts
import { pedido } from './http';

export interface Cliente {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  whatsapp: string | null;
  email: string | null;
  estado: 'Activo' | 'Potencial' | 'Inactivo';
  creado_en: number;
}

export const api = {
  listarClientes: () => pedido<Cliente[]>('/clientes'),

  crearCliente: (datos: {
    nombre: string;
    apellido: string;
    dni?: string;
    whatsapp?: string;
    email?: string;
  }) =>
    pedido<{ id: string }>('/clientes', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),
};
```

- [ ] **Step 3: Actualizar `src/api/expedientes.ts`**

```ts
import { pedido } from './http';

export interface Expediente {
  id: string;
  estudio_id: string;
  cliente_id: string;
  caratula: string;
  numero: string | null;
  fuero: string | null;
  juzgado: string | null;
  departamento: string | null;
  rol_procesal: string | null;
  estado: string;
  inicio: string | null;
  baja: string | null;
  motivo_baja: string | null;
  notas: string | null;
  creado_en: number;
  cliente_nombre: string;
  cliente_apellido: string;
}

export const api = {
  listarExpedientes: () => pedido<Expediente[]>('/expedientes'),

  obtenerExpediente: (id: string) => pedido<Expediente>(`/expedientes/${id}`),

  crearExpediente: (datos: {
    cliente_id: string;
    caratula: string;
    numero?: string;
    fuero?: string;
    juzgado?: string;
    departamento?: string;
    rol_procesal?: string;
    inicio?: string;
    notas?: string;
  }) =>
    pedido<{ id: string }>('/expedientes', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),
};
```

- [ ] **Step 4: Actualizar `src/api/presupuestos.ts`**

```ts
import { pedido } from './http';

export interface Presupuesto {
  id: string;
  estudio_id: string;
  cliente_id: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  expediente_id: string | null;
  documento_id: string | null;
  concepto: string;
  monto: number;
  estado: 'borrador' | 'enviado' | 'firmado' | 'rechazado' | 'vencido';
  fecha_emision: string | null;
  fecha_firma: string | null;
  creado_en: number;
}

export const api = {
  listarPresupuestos: () => pedido<Presupuesto[]>('/presupuestos'),

  crearPresupuesto: (datos: {
    cliente_id?: string;
    contacto_nombre?: string;
    contacto_telefono?: string;
    concepto: string;
    monto: number;
  }) =>
    pedido<{ id: string; estado: string }>('/presupuestos', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  cambiarEstado: (id: string, estado: 'enviado' | 'rechazado' | 'vencido') =>
    pedido<{ id: string; estado: string }>(`/presupuestos/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    }),

  firmar: (
    id: string,
    datos: { expediente_id: string; nombre?: string; apellido?: string; dni?: string }
  ) =>
    pedido<{ id: string; estado: string; cliente_id: string; expediente_id: string }>(
      `/presupuestos/${id}/firmar`,
      { method: 'PATCH', body: JSON.stringify(datos) }
    ),
};
```

- [ ] **Step 5: Actualizar `src/api/audiencias.ts`**

```ts
import { pedido } from './http';

export interface Audiencia {
  id: string;
  estudio_id: string;
  expediente_id: string;
  tipo: string;
  fecha: string;
  hora: string | null;
  modalidad: 'Presencial' | 'Videoconferencia' | 'Telefónica' | null;
  lugar: string | null;
  estado: 'Programada' | 'Realizada' | 'Suspendida' | 'Cancelada';
  recordatorio: number;
  recordatorio_enviado: number;
  creado_en: number;
}

export const api = {
  listarAudiencias: () => pedido<Audiencia[]>('/audiencias'),

  crearAudiencia: (datos: {
    expediente_id: string;
    tipo: string;
    fecha: string;
    hora?: string;
    modalidad?: 'Presencial' | 'Videoconferencia' | 'Telefónica';
    lugar?: string;
  }) =>
    pedido<{ id: string; tipo: string; fecha: string; estado: string }>('/audiencias', {
      method: 'POST',
      body: JSON.stringify(datos),
    }),

  cambiarEstado: (id: string, estado: 'Realizada' | 'Suspendida' | 'Cancelada') =>
    pedido<{ id: string; estado: string }>(`/audiencias/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    }),
};
```

- [ ] **Step 6: Crear `src/api/auth.ts`**

```ts
import { pedido } from './http';

export interface Identidad {
  usuario_id: string;
  nombre: string;
  apellido: string;
  estudio_id: string;
  rol: string;
}

export const api = {
  whoami: () => pedido<Identidad>('/auth/whoami'),
};
```

- [ ] **Step 7: Mostrar el usuario en `Layout.tsx`**

Reemplazar el contenido completo de `src/componentes/Layout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { api as authApi, type Identidad } from '../api/auth';

const SECCIONES = [
  { ruta: '/clientes', etiqueta: 'Clientes' },
  { ruta: '/expedientes', etiqueta: 'Expedientes' },
  { ruta: '/presupuestos', etiqueta: 'Presupuestos' },
  { ruta: '/agenda', etiqueta: 'Agenda' },
];

export function Layout() {
  const [identidad, setIdentidad] = useState<Identidad | null>(null);

  useEffect(() => {
    authApi.whoami().then(setIdentidad).catch(() => setIdentidad(null));
  }, []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 220,
          borderRight: '1px solid var(--linea)',
          padding: '28px 20px',
          background: 'var(--papel-elevado)',
        }}
      >
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontFamily: 'var(--fuente-titulo)', fontSize: 20, fontWeight: 600 }}>
            VINDEX <span style={{ color: 'var(--acento)' }}>LEGAL</span>
          </div>
          <div
            style={{
              fontFamily: 'var(--fuente-dato)',
              fontSize: 11,
              color: 'var(--tinta-suave)',
              marginTop: 2,
              letterSpacing: '0.04em',
            }}
          >
            GESTIÓN INTERNA
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECCIONES.map((s) => (
            <NavLink
              key={s.ruta}
              to={s.ruta}
              style={({ isActive }) => ({
                padding: '9px 12px',
                borderRadius: 'var(--radio)',
                textDecoration: 'none',
                color: isActive ? 'var(--acento)' : 'var(--tinta)',
                background: isActive ? 'var(--acento-suave)' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                fontSize: 14,
              })}
            >
              {s.etiqueta}
            </NavLink>
          ))}
        </nav>

        {identidad && (
          <div
            style={{
              marginTop: 40,
              paddingTop: 16,
              borderTop: '1px solid var(--linea)',
              fontSize: 13,
              color: 'var(--tinta-suave)',
            }}
          >
            {identidad.nombre} {identidad.apellido}
          </div>
        )}
      </aside>

      <main style={{ flex: 1, padding: '32px 40px', maxWidth: 1100 }}>
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: build sin errores de TypeScript (confirma que ningún otro archivo seguía importando `ESTUDIO_ID`).

- [ ] **Step 9: Commit**

```bash
git add src/api/http.ts src/api/cliente.ts src/api/expedientes.ts src/api/presupuestos.ts src/api/audiencias.ts src/api/auth.ts src/componentes/Layout.tsx
git commit -m "Sacar ESTUDIO_ID hardcodeado, usar sesion de Access, mostrar usuario autenticado"
```

---

### Task 8: Documentación de despliegue

**Files:**
- Modify: `vindexapp-api/README.md`
- Modify: `vindexapp-frontend/README.md` (si no existe contenido propio, crear uno mínimo — verificar primero con `Read`)

**Interfaces:** ninguna — solo documentación.

- [ ] **Step 1: Actualizar la sección "Pendiente" de `vindexapp-api/README.md`**

Reemplazar la sección `## Pendiente, en orden` (los puntos 1 y 2 ya están resueltos por este plan) por:

```markdown
## Configuración de Cloudflare Access (una vez, manual)

1. En el dashboard de Cloudflare Zero Trust, crear (si no existe) el team
   `vindexlegal` y conectar Google Workspace como identity provider.
2. Crear una aplicación de Access de tipo "Self-hosted" para
   `api.vindexlegal.com.ar` y otra para `panel.vindexlegal.com.ar`, ambas
   con política de acceso limitada a los emails del estudio.
3. Copiar el AUD tag de la app de `api.vindexlegal.com.ar` a
   `ACCESS_AUD` en `wrangler.jsonc` (sección `vars`).
4. Confirmar que `ACCESS_TEAM_DOMINIO` en `wrangler.jsonc` coincide con el
   team name real.
5. Desplegar (`npm run deploy`) y probar que `https://api.vindexlegal.com.ar/api/auth/whoami`
   pide login de Google Workspace antes de responder.

## Pendiente, en orden

1. RBAC granular por rol (`titular` / `asociado` / `administrativo`) —
   hoy el rol se resuelve en cada request pero no restringe nada todavía.
2. Extender el log de auditoría a otras entidades además de
   expediente/documento.
3. Calculador de plazos procesales (CPCC PBA / Ley 7425).
4. Captura asistida desde MEV/PJN (ver spec de Fase A, fuera de este repo
   todavía).
```

- [ ] **Step 2: Verificar si `vindexapp-frontend/README.md` existe**

Run: `ls vindexapp-frontend/*.md 2>&1 || echo "no existe"` (o usar el tool de listado de archivos disponible)

Si no existe, crear `vindexapp-frontend/README.md`:

```markdown
# vindexapp-frontend

Panel interno de VINDEX LEGAL App (React 19 + Vite + TypeScript). Se
despliega en `https://panel.vindexlegal.com.ar`, detrás de Cloudflare
Access (Google Workspace) — ver la configuración de Access documentada en
`vindexapp-api/README.md`.

## Desarrollo local

```bash
npm install
npm run dev
```

Requiere que `vindexapp-api` esté corriendo en `http://localhost:8787`
(`npm run dev` en ese repo). En desarrollo local no hay Cloudflare Access
delante del Worker, así que las llamadas a `/api/*` van a devolver `401`
salvo que se pegue con un JWT válido a mano — para probar el flujo
completo de auth hace falta el despliegue real detrás de Access.
```

- [ ] **Step 3: Commit (cada repo por separado)**

```bash
cd vindexapp-api
git add README.md
git commit -m "Documentar configuracion de Cloudflare Access"

cd ../vindexapp-frontend
git add README.md
git commit -m "Documentar desarrollo local y dependencia de Cloudflare Access"
```

---

## Nota sobre despliegue

Los Tasks 1–6 dejan el repo `vindexapp-api` en un estado consistente y
testeado, pero **no desplegable en producción hasta configurar Cloudflare
Access manualmente** (Task 8, Step 1) — antes de eso, `ACCESS_AUD` en
`wrangler.jsonc` sigue siendo el placeholder `REEMPLAZAR_CON_AUD_TAG_REAL`,
y con eso ningún JWT real va a verificar correctamente. No correr
`npm run deploy` hasta completar esa configuración.
