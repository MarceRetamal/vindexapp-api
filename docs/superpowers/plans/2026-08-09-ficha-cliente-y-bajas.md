# Ficha completa de cliente, edición y bajas (cliente / expediente) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the frontend read/write all the client fields the backend already supports (domicilio, localidad, teléfono fijo, email, notas), add client editing, and add logical ("dar de baja") deactivation for clientes and expedientes — no physical delete anywhere.

**Architecture:** Two repos. `vindexapp-api` (Cloudflare Worker, Hono, D1) gets one new `PATCH /api/clientes/:id` endpoint and two new `PATCH /api/expedientes/:id/baja` / `/reactivar` endpoints — no schema changes, the columns already exist. `vindexapp-frontend` (React + Vite, react-router) extends the `cliente`/`expedientes` API clients, extracts a shared `FormularioCliente` component used for both create and edit, adds a `ClienteDetalle` page (same pattern as the existing `ExpedienteDetalle`), and adds baja/reactivar controls to `ExpedienteDetalle`.

**Tech Stack:** TypeScript, Hono, Cloudflare D1 (SQLite), React 19, react-router 8, Vite.

## Global Constraints

- No physical `DELETE` anywhere in this feature — only logical state changes (`estado`, `baja`, `motivo_baja`).
- No database schema changes — `clientes.domicilio/localidad/telefono_fijo/email/notas/estado` and `expedientes.baja/motivo_baja` already exist in `migrations/0001_esquema_inicial.sql`.
- No automated test suite exists yet in either repo. Every task is verified manually: backend tasks via `curl` against `wrangler dev` (port 8787), frontend tasks via `npx tsc -b` (frontend) and a manual check in the browser against `vite` (port 5173). Both dev servers should already be running (`npm run dev` in each repo); if not, start them in the background before verifying.
- Follow existing code conventions exactly: inline `style={{...}}` objects (no CSS files/classes), the `campo`/`etiqueta` style-object pattern already used in every form, Hono handler style already used in `src/rutas/*.ts` (404/409 JSON error shape, `try/catch` around `UNIQUE constraint failed`).
- `ESTUDIO_ID` (frontend constant, `src/api/http.ts`) is `f5b149e2-810a-4ca4-a606-747c35602cb6` for local dev — used throughout the verification `curl` commands below.

---

## Task 1: Backend — `PATCH /api/clientes/:id`

**Files:**
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-api\src\rutas\clientes.ts`

**Interfaces:**
- Produces: `PATCH /api/clientes/:id` — body is a partial `{ nombre?, apellido?, dni?, domicilio?, localidad?, telefono_fijo?, whatsapp?, email?, estado?, notas? }`. Returns the full updated cliente row (200), `404` if the id doesn't exist, `409` if `dni` collides with another cliente in the same estudio, `400` if the body has no recognized fields. Later tasks (3, and the "dar de baja" logic in Task 6) call this endpoint with `{estado: 'Activo' | 'Inactivo'}` to do soft-delete/reactivate — no separate endpoint for that.

- [ ] **Step 1: Add the PATCH handler**

Open `src/rutas/clientes.ts`. After the existing `clientesRouter.get('/:id', ...)` handler (the last block in the file), add:

```ts
/** Actualiza campos de un cliente existente. Solo pisa los campos presentes en el body. */
clientesRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    nombre?: string;
    apellido?: string;
    dni?: string;
    domicilio?: string;
    localidad?: string;
    telefono_fijo?: string;
    whatsapp?: string;
    email?: string;
    estado?: 'Activo' | 'Potencial' | 'Inactivo';
    notas?: string;
  }>();

  const actual = await c.env.DB.prepare(
    'SELECT id, estudio_id FROM clientes WHERE id = ?'
  )
    .bind(id)
    .first<{ id: string; estudio_id: string }>();

  if (!actual) {
    return c.json({ error: 'Cliente no encontrado.' }, 404);
  }

  if (body.dni) {
    const existente = await c.env.DB.prepare(
      'SELECT id, nombre, apellido FROM clientes WHERE estudio_id = ? AND dni = ? AND id != ?'
    )
      .bind(actual.estudio_id, body.dni, id)
      .first<{ id: string; nombre: string; apellido: string }>();

    if (existente) {
      return c.json(
        { error: 'Ya existe un cliente con ese DNI.', cliente_existente: existente },
        409
      );
    }
  }

  const campos: Record<string, unknown> = {
    nombre: body.nombre,
    apellido: body.apellido,
    dni: body.dni,
    domicilio: body.domicilio,
    localidad: body.localidad,
    telefono_fijo: body.telefono_fijo,
    whatsapp: body.whatsapp,
    email: body.email,
    estado: body.estado,
    notas: body.notas,
  };

  const entradas = Object.entries(campos).filter(([, valor]) => valor !== undefined);

  if (entradas.length === 0) {
    return c.json({ error: 'No se recibió ningún campo para actualizar.' }, 400);
  }

  const asignaciones = entradas.map(([campo]) => `${campo} = ?`).join(', ');
  const valores = entradas.map(([, valor]) => valor);

  try {
    await c.env.DB.prepare(`UPDATE clientes SET ${asignaciones} WHERE id = ?`)
      .bind(...valores, id)
      .run();
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un cliente con ese DNI.' }, 409);
    }
    throw err;
  }

  const actualizado = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?')
    .bind(id)
    .first();

  return c.json(actualizado);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` (from `vindexapp-api`)
Expected: no errors.

- [ ] **Step 3: Verify 404 on unknown id**

`wrangler dev` auto-reloads on save. Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://127.0.0.1:8787/api/clientes/no-existe \
  -H "Content-Type: application/json" \
  -d '{"domicilio":"Calle Falsa 123"}'
```

Expected: `404`

- [ ] **Step 4: Verify partial update persists**

Using the seeded cliente `6bf77801-e7f4-4b94-8ab3-e03232410a25` (Lucía Bianchi E2E) — substitute a real id from `curl -s "http://127.0.0.1:8787/api/clientes?estudio_id=f5b149e2-810a-4ca4-a606-747c35602cb6"` if this one no longer exists in your local D1:

```bash
curl -s -X PATCH http://127.0.0.1:8787/api/clientes/6bf77801-e7f4-4b94-8ab3-e03232410a25 \
  -H "Content-Type: application/json" \
  -d '{"domicilio":"Av. Siempre Viva 742","localidad":"La Plata","email":"lucia@example.com"}'
```

Expected: `200` with a JSON body showing `domicilio: "Av. Siempre Viva 742"`, `localidad: "La Plata"`, `email: "lucia@example.com"`, and every other field unchanged (e.g. `dni` still `"28999111"`).

Then confirm it persisted:

```bash
curl -s "http://127.0.0.1:8787/api/clientes/6bf77801-e7f4-4b94-8ab3-e03232410a25"
```

Expected: same `domicilio`/`localidad`/`email` values.

- [ ] **Step 5: Verify DNI conflict returns 409**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH http://127.0.0.1:8787/api/clientes/6bf77801-e7f4-4b94-8ab3-e03232410a25 \
  -H "Content-Type: application/json" \
  -d '{"dni":"28464208"}'
```

(`28464208` belongs to the other seeded cliente, Silvana Perez Gauna.) Expected: `409`.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\estudio\OneDrive\Escritorio\vindexapp-api"
git add src/rutas/clientes.ts
git commit -m "feat(api): agregar PATCH /clientes/:id para edicion y baja logica"
```

---

## Task 2: Backend — `PATCH /api/expedientes/:id/baja` and `/reactivar`

**Files:**
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-api\src\rutas\expedientes.ts`

**Interfaces:**
- Produces: `PATCH /api/expedientes/:id/baja?estudio_id=...` — body `{ motivo?: string }`. Sets `estado = 'Archivado'`, `baja = <fecha ISO de hoy>`, `motivo_baja = motivo ?? null`. Returns the updated expediente (200), `404` if not found for that `estudio_id`, `400` if `estudio_id` query param missing.
- Produces: `PATCH /api/expedientes/:id/reactivar?estudio_id=...` — no body. Sets `estado = 'En trámite'`, `baja = NULL`, `motivo_baja = NULL`. Same 200/404/400 shape.
- Both follow the exact `estudio_id`-in-query-param pattern already used by `GET /:id` in this same file (line ~92-111 before this task).

- [ ] **Step 1: Add both handlers**

Open `src/rutas/expedientes.ts`. After the existing `expedientesRouter.get('/:id', ...)` handler (the last block in the file), add:

```ts
/** Da de baja un expediente (baja lógica: no borra el registro). */
expedientesRouter.patch('/:id/baja', async (c) => {
  const id = c.req.param('id');
  const estudioId = c.req.query('estudio_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const { motivo } = await c.req.json<{ motivo?: string }>();

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, estudioId)
    .first();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  const hoy = new Date().toISOString().slice(0, 10);

  await c.env.DB.prepare(
    `UPDATE expedientes SET estado = 'Archivado', baja = ?, motivo_baja = ? WHERE id = ?`
  )
    .bind(hoy, motivo ?? null, id)
    .run();

  const actualizado = await c.env.DB.prepare('SELECT * FROM expedientes WHERE id = ?')
    .bind(id)
    .first();

  return c.json(actualizado);
});

/** Reactiva un expediente dado de baja. */
expedientesRouter.patch('/:id/reactivar', async (c) => {
  const id = c.req.param('id');
  const estudioId = c.req.query('estudio_id');

  if (!estudioId) {
    return c.json({ error: 'estudio_id es obligatorio como parámetro de consulta.' }, 400);
  }

  const expediente = await c.env.DB.prepare(
    'SELECT id FROM expedientes WHERE id = ? AND estudio_id = ?'
  )
    .bind(id, estudioId)
    .first();

  if (!expediente) {
    return c.json({ error: 'Expediente no encontrado.' }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE expedientes SET estado = 'En trámite', baja = NULL, motivo_baja = NULL WHERE id = ?`
  )
    .bind(id)
    .run();

  const actualizado = await c.env.DB.prepare('SELECT * FROM expedientes WHERE id = ?')
    .bind(id)
    .first();

  return c.json(actualizado);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify baja with motivo**

Using the seeded expediente `c5b4170c-ac56-410e-9078-b47c93188fc3` (Bianchi E2E) — substitute a real id from `curl -s "http://127.0.0.1:8787/api/expedientes?estudio_id=f5b149e2-810a-4ca4-a606-747c35602cb6"` if needed:

```bash
curl -s -X PATCH "http://127.0.0.1:8787/api/expedientes/c5b4170c-ac56-410e-9078-b47c93188fc3/baja?estudio_id=f5b149e2-810a-4ca4-a606-747c35602cb6" \
  -H "Content-Type: application/json" \
  -d '{"motivo":"Cliente desistió de la acción"}'
```

Expected: `200`, body shows `estado: "Archivado"`, `baja` set to today's date (`YYYY-MM-DD`), `motivo_baja: "Cliente desistió de la acción"`.

- [ ] **Step 4: Verify baja without motivo**

```bash
curl -s -X PATCH "http://127.0.0.1:8787/api/expedientes/c5b4170c-ac56-410e-9078-b47c93188fc3/reactivar?estudio_id=f5b149e2-810a-4ca4-a606-747c35602cb6"
```

(Reactivate first so the next call is testing baja from a clean state.) Then:

```bash
curl -s -X PATCH "http://127.0.0.1:8787/api/expedientes/c5b4170c-ac56-410e-9078-b47c93188fc3/baja?estudio_id=f5b149e2-810a-4ca4-a606-747c35602cb6" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `200`, `estado: "Archivado"`, `motivo_baja: null`.

- [ ] **Step 5: Verify reactivar clears baja fields**

```bash
curl -s -X PATCH "http://127.0.0.1:8787/api/expedientes/c5b4170c-ac56-410e-9078-b47c93188fc3/reactivar?estudio_id=f5b149e2-810a-4ca4-a606-747c35602cb6"
```

Expected: `200`, `estado: "En trámite"`, `baja: null`, `motivo_baja: null`.

- [ ] **Step 6: Verify 404 for wrong estudio_id**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://127.0.0.1:8787/api/expedientes/c5b4170c-ac56-410e-9078-b47c93188fc3/baja?estudio_id=00000000-0000-0000-0000-000000000000" \
  -H "Content-Type: application/json" -d '{}'
```

Expected: `404`.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\estudio\OneDrive\Escritorio\vindexapp-api"
git add src/rutas/expedientes.ts
git commit -m "feat(api): agregar baja logica y reactivacion de expedientes"
```

---

## Task 3: Frontend — extend `src/api/cliente.ts`

**Files:**
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\api\cliente.ts`

**Interfaces:**
- Consumes: `GET /api/clientes/:id` (existing backend route), `PATCH /api/clientes/:id` (Task 1).
- Produces: `Cliente` type now includes `domicilio: string | null`, `localidad: string | null`, `telefono_fijo: string | null`, `notas: string | null`. New exported type `DatosCliente` (create/edit payload shape). New `api.obtenerCliente(id: string): Promise<Cliente>` and `api.actualizarCliente(id: string, datos: Partial<DatosCliente>): Promise<Cliente>`. Task 5 (`FormularioCliente`) and Task 6 (`ClienteDetalle`) both import `Cliente`, `DatosCliente`, and these two functions by these exact names.

- [ ] **Step 1: Replace the file contents**

```ts
import { ESTUDIO_ID, pedido } from './http';

export interface Cliente {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  domicilio: string | null;
  localidad: string | null;
  telefono_fijo: string | null;
  whatsapp: string | null;
  email: string | null;
  estado: 'Activo' | 'Potencial' | 'Inactivo';
  notas: string | null;
  creado_en: number;
}

export interface DatosCliente {
  nombre: string;
  apellido: string;
  dni?: string;
  domicilio?: string;
  localidad?: string;
  telefono_fijo?: string;
  whatsapp?: string;
  email?: string;
  estado?: Cliente['estado'];
  notas?: string;
}

export const api = {
  listarClientes: () => pedido<Cliente[]>(`/clientes?estudio_id=${ESTUDIO_ID}`),

  obtenerCliente: (id: string) => pedido<Cliente>(`/clientes/${id}`),

  crearCliente: (datos: DatosCliente) =>
    pedido<{ id: string }>('/clientes', {
      method: 'POST',
      body: JSON.stringify({ estudio_id: ESTUDIO_ID, ...datos }),
    }),

  actualizarCliente: (id: string, datos: Partial<DatosCliente>) =>
    pedido<Cliente>(`/clientes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(datos),
    }),
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b` (from `vindexapp-frontend`)
Expected: errors in `Clientes.tsx` — it still references the old, narrower `Cliente`-consuming `FormularioNuevoCliente` and passes `datos` shaped for the old `crearCliente`. This is expected; Task 5 fixes it. Confirm the errors are only in `src/paginas/Clientes.tsx`, not in `src/api/cliente.ts` itself.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend"
git add src/api/cliente.ts
git commit -m "feat(api-client): tipar campos completos de cliente y agregar obtener/actualizarCliente"
```

---

## Task 4: Frontend — extend `src/api/expedientes.ts`

**Files:**
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\api\expedientes.ts`

**Interfaces:**
- Consumes: `PATCH /api/expedientes/:id/baja`, `PATCH /api/expedientes/:id/reactivar` (Task 2).
- Produces: `api.darDeBajaExpediente(id: string, motivo?: string): Promise<Expediente>`, `api.reactivarExpediente(id: string): Promise<Expediente>`. Task 7 (`ExpedienteDetalle`) calls these by these exact names.

- [ ] **Step 1: Add the two functions**

In `src/api/expedientes.ts`, inside the `api` object (after `crearExpediente`), add:

```ts
  darDeBajaExpediente: (id: string, motivo?: string) =>
    pedido<Expediente>(`/expedientes/${id}/baja?estudio_id=${ESTUDIO_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ motivo }),
    }),

  reactivarExpediente: (id: string) =>
    pedido<Expediente>(`/expedientes/${id}/reactivar?estudio_id=${ESTUDIO_ID}`, {
      method: 'PATCH',
    }),
```

The full `api` object in the file should now read:

```ts
export const api = {
  listarExpedientes: () => pedido<Expediente[]>(`/expedientes?estudio_id=${ESTUDIO_ID}`),

  obtenerExpediente: (id: string) =>
    pedido<Expediente>(`/expedientes/${id}?estudio_id=${ESTUDIO_ID}`),

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
      body: JSON.stringify({ estudio_id: ESTUDIO_ID, ...datos }),
    }),

  darDeBajaExpediente: (id: string, motivo?: string) =>
    pedido<Expediente>(`/expedientes/${id}/baja?estudio_id=${ESTUDIO_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ motivo }),
    }),

  reactivarExpediente: (id: string) =>
    pedido<Expediente>(`/expedientes/${id}/reactivar?estudio_id=${ESTUDIO_ID}`, {
      method: 'PATCH',
    }),
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: same pre-existing `Clientes.tsx` errors as Task 3 (not yet fixed), no new errors from `expedientes.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/api/expedientes.ts
git commit -m "feat(api-client): agregar darDeBajaExpediente y reactivarExpediente"
```

---

## Task 5: Frontend — shared `FormularioCliente` + `Clientes.tsx` refactor

**Files:**
- Create: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\componentes\FormularioCliente.tsx`
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\paginas\Clientes.tsx`

**Interfaces:**
- Consumes: `Cliente`, `DatosCliente`, `api.crearCliente`, `api.actualizarCliente` from `src/api/cliente.ts` (Task 3).
- Produces: `FormularioCliente({ cliente?: Cliente; onGuardado: () => void; onCancelar?: () => void })` — renders create form when `cliente` is omitted, edit form (pre-filled) when provided. Calls `onGuardado()` after a successful save (caller is responsible for reloading data / closing the form). Task 6 (`ClienteDetalle`) imports and reuses this exact component. `Clientes.tsx` exports `EstadoBadge({ estado: Cliente['estado'] })`, reused by Task 6.

- [ ] **Step 1: Create `src/componentes/FormularioCliente.tsx`**

```tsx
import { useState } from 'react';
import { api, type Cliente, type DatosCliente } from '../api/cliente';

const campo: React.CSSProperties = {
  border: '1px solid var(--linea)',
  borderRadius: 'var(--radio)',
  padding: '9px 12px',
  fontSize: 14,
  background: 'var(--papel-elevado)',
};

const etiqueta: React.CSSProperties = { fontSize: 12, color: 'var(--tinta-suave)' };

export function FormularioCliente({
  cliente,
  onGuardado,
  onCancelar,
}: {
  cliente?: Cliente;
  onGuardado: () => void;
  onCancelar?: () => void;
}) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? '');
  const [apellido, setApellido] = useState(cliente?.apellido ?? '');
  const [dni, setDni] = useState(cliente?.dni ?? '');
  const [domicilio, setDomicilio] = useState(cliente?.domicilio ?? '');
  const [localidad, setLocalidad] = useState(cliente?.localidad ?? '');
  const [telefonoFijo, setTelefonoFijo] = useState(cliente?.telefono_fijo ?? '');
  const [whatsapp, setWhatsapp] = useState(cliente?.whatsapp ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [notas, setNotas] = useState(cliente?.notas ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const datos: DatosCliente = {
      nombre,
      apellido,
      dni: dni || undefined,
      domicilio: domicilio || undefined,
      localidad: localidad || undefined,
      telefono_fijo: telefonoFijo || undefined,
      whatsapp: whatsapp || undefined,
      email: email || undefined,
      notas: notas || undefined,
    };

    try {
      if (cliente) {
        await api.actualizarCliente(cliente.id, datos);
      } else {
        await api.crearCliente(datos);
      }
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el cliente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      onSubmit={enviar}
      style={{
        border: '1px solid var(--linea)',
        borderRadius: 'var(--radio)',
        padding: 20,
        marginBottom: 24,
        background: 'var(--papel-elevado)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-nombre" style={etiqueta}>Nombre</label>
        <input id="cliente-nombre" style={campo} value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-apellido" style={etiqueta}>Apellido</label>
        <input id="cliente-apellido" style={campo} value={apellido} onChange={(e) => setApellido(e.target.value)} required />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-dni" style={etiqueta}>DNI</label>
        <input id="cliente-dni" style={campo} value={dni} onChange={(e) => setDni(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-email" style={etiqueta}>Email</label>
        <input id="cliente-email" type="email" style={campo} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-whatsapp" style={etiqueta}>WhatsApp</label>
        <input id="cliente-whatsapp" style={campo} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-telefono" style={etiqueta}>Teléfono fijo</label>
        <input id="cliente-telefono" style={campo} value={telefonoFijo} onChange={(e) => setTelefonoFijo(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-domicilio" style={etiqueta}>Domicilio</label>
        <input id="cliente-domicilio" style={campo} value={domicilio} onChange={(e) => setDomicilio(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="cliente-localidad" style={etiqueta}>Localidad</label>
        <input id="cliente-localidad" style={campo} value={localidad} onChange={(e) => setLocalidad(e.target.value)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
        <label htmlFor="cliente-notas" style={etiqueta}>Notas</label>
        <textarea
          id="cliente-notas"
          style={{ ...campo, resize: 'vertical', minHeight: 60 }}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />
      </div>

      {error && (
        <div style={{ gridColumn: '1 / -1', color: 'var(--alerta)', fontSize: 13 }}>{error}</div>
      )}

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={enviando}
          style={{
            background: 'var(--acento)',
            color: 'var(--papel)',
            border: 'none',
            borderRadius: 'var(--radio)',
            padding: '9px 18px',
            fontSize: 14,
            fontWeight: 600,
            opacity: enviando ? 0.6 : 1,
          }}
        >
          {enviando ? 'Guardando…' : cliente ? 'Guardar cambios' : 'Guardar cliente'}
        </button>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            disabled={enviando}
            style={{
              background: 'transparent',
              color: 'var(--tinta-suave)',
              border: '1px solid var(--linea)',
              borderRadius: 'var(--radio)',
              padding: '9px 18px',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Replace `src/paginas/Clientes.tsx` contents**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, type Cliente } from '../api/cliente';
import { FormularioCliente } from '../componentes/FormularioCliente';

export function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  function cargar() {
    setCargando(true);
    setError(null);
    api
      .listarClientes()
      .then(setClientes)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, []);

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 28,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26 }}>Clientes</h1>
          <p style={{ color: 'var(--tinta-suave)', margin: '4px 0 0', fontSize: 13 }}>
            {clientes.length} {clientes.length === 1 ? 'cliente registrado' : 'clientes registrados'}
          </p>
        </div>
        <button
          onClick={() => setMostrarFormulario((v) => !v)}
          style={{
            background: 'var(--tinta)',
            color: 'var(--papel)',
            border: 'none',
            borderRadius: 'var(--radio)',
            padding: '9px 16px',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {mostrarFormulario ? 'Cancelar' : '+ Nuevo cliente'}
        </button>
      </header>

      {mostrarFormulario && (
        <FormularioCliente
          onGuardado={() => {
            setMostrarFormulario(false);
            cargar();
          }}
        />
      )}

      {error && (
        <div
          style={{
            background: '#fdf1ef',
            border: '1px solid var(--alerta)',
            color: 'var(--alerta)',
            padding: '12px 16px',
            borderRadius: 'var(--radio)',
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          No se pudo cargar el listado: {error}
        </div>
      )}

      {cargando ? (
        <p style={{ color: 'var(--tinta-suave)' }}>Cargando…</p>
      ) : clientes.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--linea)',
            borderRadius: 'var(--radio)',
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--tinta-suave)',
          }}
        >
          Todavía no hay clientes cargados. Usá "Nuevo cliente" para agregar el primero.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {clientes.map((c, i) => (
            <FilaCliente key={c.id} cliente={c} numero={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaCliente({ cliente, numero }: { cliente: Cliente; numero: number }) {
  return (
    <Link to={`/clientes/${cliente.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '14px 4px',
          borderBottom: '1px solid var(--linea)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--fuente-dato)',
            fontSize: 12,
            color: 'var(--tinta-suave)',
            width: 28,
          }}
        >
          {String(numero).padStart(2, '0')}
        </span>
        <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--acento)', opacity: 0.4 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {cliente.apellido}, {cliente.nombre}
          </div>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginTop: 2 }}>
            {cliente.dni ? `DNI ${cliente.dni}` : 'Sin DNI cargado'}
            {cliente.whatsapp ? ` · ${cliente.whatsapp}` : ''}
          </div>
        </div>
        <EstadoBadge estado={cliente.estado} />
      </div>
    </Link>
  );
}

export function EstadoBadge({ estado }: { estado: Cliente['estado'] }) {
  const colores: Record<Cliente['estado'], string> = {
    Activo: 'var(--exito)',
    Potencial: 'var(--alerta)',
    Inactivo: 'var(--tinta-suave)',
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: colores[estado],
        border: `1px solid ${colores[estado]}`,
        borderRadius: 'var(--radio)',
        padding: '3px 8px',
        letterSpacing: '0.02em',
      }}
    >
      {estado.toUpperCase()}
    </span>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors anywhere (this clears the `Clientes.tsx` errors left over from Tasks 3-4; `ClienteDetalle.tsx` doesn't exist yet so `rutas.tsx` is untouched and still fine).

- [ ] **Step 4: Manual browser check**

With `vite` running on `http://localhost:5173`: open `/clientes`, click "+ Nuevo cliente", fill Nombre/Apellido/DNI/Email/WhatsApp/Teléfono fijo/Domicilio/Localidad/Notas, submit. Confirm the new client appears in the list. Click the new client's row — confirm it navigates to `/clientes/<id>` (this route doesn't exist yet, so React Router will show its default "no route matched" — that's expected and fixed by Task 6; the point of this check is confirming the row is now a working link and the create flow with new fields works).

- [ ] **Step 5: Commit**

```bash
git add src/componentes/FormularioCliente.tsx src/paginas/Clientes.tsx
git commit -m "feat(frontend): formulario de cliente completo y reutilizable, listado enlaza a detalle"
```

---

## Task 6: Frontend — `ClienteDetalle` page + route

**Files:**
- Create: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\paginas\ClienteDetalle.tsx`
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\rutas.tsx`

**Interfaces:**
- Consumes: `api.obtenerCliente`, `api.actualizarCliente` (Task 3), `FormularioCliente` (Task 5), `EstadoBadge` (Task 5, exported from `Clientes.tsx`).
- Produces: route `clientes/:id` → `ClienteDetalle`. No other task depends on this component's internals.

- [ ] **Step 1: Create `src/paginas/ClienteDetalle.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Cliente } from '../api/cliente';
import { EstadoBadge } from './Clientes';
import { FormularioCliente } from '../componentes/FormularioCliente';

export function ClienteDetalle() {
  const { id } = useParams<{ id: string }>();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  function cargar() {
    if (!id) return;
    setCargando(true);
    setError(null);
    api
      .obtenerCliente(id)
      .then(setCliente)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, [id]);

  async function cambiarEstado(estado: 'Activo' | 'Inactivo') {
    if (!cliente) return;
    setProcesando(true);
    setErrorEstado(null);
    try {
      await api.actualizarCliente(cliente.id, { estado });
      cargar();
    } catch (err) {
      setErrorEstado(err instanceof Error ? err.message : 'No se pudo actualizar el estado.');
    } finally {
      setProcesando(false);
    }
  }

  if (cargando) {
    return <p style={{ color: 'var(--tinta-suave)' }}>Cargando…</p>;
  }

  if (error) {
    return (
      <div>
        <VolverAClientes />
        <div
          style={{
            marginTop: 16,
            background: '#fdf1ef',
            border: '1px solid var(--alerta)',
            color: 'var(--alerta)',
            padding: '12px 16px',
            borderRadius: 'var(--radio)',
            fontSize: 13,
          }}
        >
          No se pudo cargar el cliente: {error}
        </div>
      </div>
    );
  }

  if (!cliente) {
    return null;
  }

  if (editando) {
    return (
      <div>
        <VolverAClientes />
        <header style={{ margin: '16px 0 28px' }}>
          <h1 style={{ fontSize: 24 }}>
            {cliente.apellido}, {cliente.nombre}
          </h1>
        </header>
        <FormularioCliente
          cliente={cliente}
          onGuardado={() => {
            setEditando(false);
            cargar();
          }}
          onCancelar={() => setEditando(false)}
        />
      </div>
    );
  }

  return (
    <div>
      <VolverAClientes />

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          margin: '16px 0 28px',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24 }}>
            {cliente.apellido}, {cliente.nombre}
          </h1>
          <div style={{ marginTop: 8 }}>
            <EstadoBadge estado={cliente.estado} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditando(true)} style={botonSecundario}>
            Editar
          </button>
          {cliente.estado === 'Inactivo' ? (
            <button disabled={procesando} onClick={() => cambiarEstado('Activo')} style={botonSecundario}>
              Reactivar
            </button>
          ) : (
            <button disabled={procesando} onClick={() => cambiarEstado('Inactivo')} style={botonSecundario}>
              Dar de baja
            </button>
          )}
        </div>
      </header>

      {errorEstado && (
        <div style={{ color: 'var(--alerta)', fontSize: 13, marginBottom: 16 }}>{errorEstado}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Dato etiqueta="DNI" valor={cliente.dni} />
        <Dato etiqueta="Email" valor={cliente.email} />
        <Dato etiqueta="Teléfono fijo" valor={cliente.telefono_fijo} />
        <Dato etiqueta="WhatsApp" valor={cliente.whatsapp} />
        <Dato etiqueta="Domicilio" valor={cliente.domicilio} />
        <Dato etiqueta="Localidad" valor={cliente.localidad} />
      </div>

      {cliente.notas && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginBottom: 4 }}>Notas</div>
          <p style={{ fontSize: 14 }}>{cliente.notas}</p>
        </div>
      )}
    </div>
  );
}

const botonSecundario: React.CSSProperties = {
  border: '1px solid var(--linea)',
  background: 'var(--papel-elevado)',
  borderRadius: 'var(--radio)',
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--tinta)',
};

function VolverAClientes() {
  return (
    <Link to="/clientes" style={{ fontSize: 13, color: 'var(--acento)', textDecoration: 'none' }}>
      ← Volver a clientes
    </Link>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginBottom: 2 }}>{etiqueta}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{valor ?? '—'}</div>
    </div>
  );
}
```

- [ ] **Step 2: Wire up the route in `src/rutas.tsx`**

Replace the file contents with:

```tsx
import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './componentes/Layout';
import { Clientes } from './paginas/Clientes';
import { ClienteDetalle } from './paginas/ClienteDetalle';
import { Expedientes } from './paginas/Expedientes';
import { ExpedienteDetalle } from './paginas/ExpedienteDetalle';
import { Presupuestos } from './paginas/Presupuestos';
import { Agenda } from './paginas/Agenda';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/clientes" replace /> },
      { path: 'clientes', element: <Clientes /> },
      { path: 'clientes/:id', element: <ClienteDetalle /> },
      { path: 'expedientes', element: <Expedientes /> },
      { path: 'expedientes/:id', element: <ExpedienteDetalle /> },
      { path: 'presupuestos', element: <Presupuestos /> },
      { path: 'agenda', element: <Agenda /> },
    ],
  },
]);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Manual browser check**

With both `wrangler dev` and `vite` running: open `http://localhost:5173/clientes`, click a client row. Confirm the detail page loads showing DNI/Email/Teléfono fijo/WhatsApp/Domicilio/Localidad (with `—` for any empty ones) and the estado badge. Click "Editar", change the Localidad field, submit — confirm it returns to read mode showing the new value. Click "Dar de baja" — confirm the badge changes to `INACTIVO` and the button becomes "Reactivar". Click "Reactivar" — confirm it goes back to `ACTIVO`. Reload `/clientes` and confirm the same client's row also reflects the current estado.

- [ ] **Step 5: Commit**

```bash
git add src/paginas/ClienteDetalle.tsx src/rutas.tsx
git commit -m "feat(frontend): pagina de detalle de cliente con edicion y baja/reactivacion"
```

---

## Task 7: Frontend — baja/reactivar UI in `ExpedienteDetalle`

**Files:**
- Modify: `C:\Users\estudio\OneDrive\Escritorio\vindexapp-frontend\src\paginas\ExpedienteDetalle.tsx`

**Interfaces:**
- Consumes: `api.darDeBajaExpediente`, `api.reactivarExpediente` (Task 4).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Replace `src/paginas/ExpedienteDetalle.tsx` contents**

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Expediente } from '../api/expedientes';

export function ExpedienteDetalle() {
  const { id } = useParams<{ id: string }>();
  const [expediente, setExpediente] = useState<Expediente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mostrarMotivo, setMostrarMotivo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [errorEstado, setErrorEstado] = useState<string | null>(null);

  function cargar() {
    if (!id) return;
    setCargando(true);
    setError(null);
    api
      .obtenerExpediente(id)
      .then(setExpediente)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(cargar, [id]);

  async function darDeBaja() {
    if (!expediente) return;
    setProcesando(true);
    setErrorEstado(null);
    try {
      await api.darDeBajaExpediente(expediente.id, motivo || undefined);
      setMostrarMotivo(false);
      setMotivo('');
      cargar();
    } catch (err) {
      setErrorEstado(err instanceof Error ? err.message : 'No se pudo dar de baja el expediente.');
    } finally {
      setProcesando(false);
    }
  }

  async function reactivar() {
    if (!expediente) return;
    setProcesando(true);
    setErrorEstado(null);
    try {
      await api.reactivarExpediente(expediente.id);
      cargar();
    } catch (err) {
      setErrorEstado(err instanceof Error ? err.message : 'No se pudo reactivar el expediente.');
    } finally {
      setProcesando(false);
    }
  }

  if (cargando) {
    return <p style={{ color: 'var(--tinta-suave)' }}>Cargando…</p>;
  }

  if (error) {
    return (
      <div>
        <VolverAExpedientes />
        <div
          style={{
            marginTop: 16,
            background: '#fdf1ef',
            border: '1px solid var(--alerta)',
            color: 'var(--alerta)',
            padding: '12px 16px',
            borderRadius: 'var(--radio)',
            fontSize: 13,
          }}
        >
          No se pudo cargar el expediente: {error}
        </div>
      </div>
    );
  }

  if (!expediente) {
    return null;
  }

  const archivado = expediente.estado === 'Archivado';

  return (
    <div>
      <VolverAExpedientes />

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          margin: '16px 0 28px',
        }}
      >
        <div>
          <h1 style={{ fontSize: 24 }}>{expediente.caratula}</h1>
          <p style={{ color: 'var(--tinta-suave)', margin: '4px 0 0', fontSize: 13 }}>
            {expediente.cliente_apellido}, {expediente.cliente_nombre}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {archivado ? (
            <button disabled={procesando} onClick={reactivar} style={botonSecundario}>
              Reactivar
            </button>
          ) : (
            <button disabled={procesando} onClick={() => setMostrarMotivo((v) => !v)} style={botonSecundario}>
              {mostrarMotivo ? 'Cancelar' : 'Dar de baja'}
            </button>
          )}
        </div>
      </header>

      {mostrarMotivo && !archivado && (
        <div
          style={{
            border: '1px solid var(--linea)',
            borderRadius: 'var(--radio)',
            padding: 16,
            marginBottom: 24,
            background: 'var(--papel-elevado)',
          }}
        >
          <label htmlFor="motivo-baja" style={{ fontSize: 12, color: 'var(--tinta-suave)' }}>
            Motivo (opcional)
          </label>
          <textarea
            id="motivo-baja"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 4,
              border: '1px solid var(--linea)',
              borderRadius: 'var(--radio)',
              padding: '9px 12px',
              fontSize: 14,
              background: 'var(--papel)',
              resize: 'vertical',
              minHeight: 60,
            }}
          />
          <button disabled={procesando} onClick={darDeBaja} style={{ ...botonSecundario, marginTop: 12 }}>
            Confirmar baja
          </button>
        </div>
      )}

      {errorEstado && (
        <div style={{ color: 'var(--alerta)', fontSize: 13, marginBottom: 16 }}>{errorEstado}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Dato etiqueta="Estado" valor={expediente.estado} />
        <Dato etiqueta="Número" valor={expediente.numero} />
        <Dato etiqueta="Fuero" valor={expediente.fuero} />
        <Dato etiqueta="Juzgado" valor={expediente.juzgado} />
        <Dato etiqueta="Departamento judicial" valor={expediente.departamento} />
        <Dato etiqueta="Rol procesal" valor={expediente.rol_procesal} />
        <Dato etiqueta="Inicio" valor={expediente.inicio} />
        {expediente.baja && <Dato etiqueta="Baja" valor={expediente.baja} />}
      </div>

      {expediente.motivo_baja && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginBottom: 4 }}>Motivo de baja</div>
          <p style={{ fontSize: 14 }}>{expediente.motivo_baja}</p>
        </div>
      )}

      {expediente.notas && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginBottom: 4 }}>Notas</div>
          <p style={{ fontSize: 14 }}>{expediente.notas}</p>
        </div>
      )}
    </div>
  );
}

const botonSecundario: React.CSSProperties = {
  border: '1px solid var(--linea)',
  background: 'var(--papel-elevado)',
  borderRadius: 'var(--radio)',
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--tinta)',
};

function VolverAExpedientes() {
  return (
    <Link to="/expedientes" style={{ fontSize: 13, color: 'var(--acento)', textDecoration: 'none' }}>
      ← Volver a expedientes
    </Link>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--tinta-suave)', marginBottom: 2 }}>{etiqueta}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{valor ?? '—'}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Manual browser check**

Open `http://localhost:5173/expedientes`, click an expediente row. Click "Dar de baja" — confirm a motivo textarea appears. Type a motivo, click "Confirmar baja" — confirm the page reloads showing `Estado: Archivado`, a new "Baja" field with today's date, a "Motivo de baja" section with the text you typed, and the button now reads "Reactivar". Click "Reactivar" — confirm it goes back to `Estado: En trámite` and the "Baja"/"Motivo de baja" sections disappear. Repeat once leaving the motivo textarea empty — confirm baja still works and no "Motivo de baja" section appears.

- [ ] **Step 4: Commit**

```bash
git add src/paginas/ExpedienteDetalle.tsx
git commit -m "feat(frontend): baja logica y reactivacion de expedientes en el detalle"
```
