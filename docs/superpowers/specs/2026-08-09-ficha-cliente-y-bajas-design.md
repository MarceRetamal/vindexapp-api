# Ficha completa de cliente, edición y bajas (cliente / expediente)

**Fecha:** 2026-08-09
**Repos afectados:** `vindexapp-frontend` (principal), `vindexapp-api` (endpoints nuevos)
**Milestone:** post-M1

## Contexto

El backend de `clientes` ya soporta `domicilio`, `localidad`, `telefono_fijo`,
`email` y `notas` desde el esquema inicial (`migrations/0001_esquema_inicial.sql`),
pero el frontend nunca los expuso: ni el tipo `Cliente` en
`src/api/cliente.ts`, ni el formulario de alta en `Clientes.tsx`, los incluyen.
El formulario actual solo pide Nombre, Apellido, DNI y WhatsApp.

Separado de eso, la app no tiene forma de dar de baja un cliente o un
expediente. Se decidió explícitamente que esto **no es borrado físico**: en
una app de gestión legal, clientes y expedientes son registros con peso
probatorio y fiduciario (auditorías, reclamos de mala praxis, disputas con
clientes) que no pueden desaparecer de la base. El patrón es baja lógica
(cambio de estado), igual al que ya usa `audiencias` con su columna `estado`
y el endpoint `PATCH /audiencias/:id/estado`.

Decisiones confirmadas por el usuario:

- Los campos de cliente a exponer son los que ya soporta el backend
  (domicilio, localidad, teléfono fijo, email, notas) — no hace falta agregar
  columnas nuevas.
- La edición de clientes sigue el mismo patrón visual que ya usa
  `ExpedienteDetalle.tsx`: página de detalle con botón "Editar", no modal ni
  edición inline en el listado.
- La baja de clientes y expedientes es lógica (estado), no `DELETE` físico.
- El motivo de baja de un expediente es opcional.
- Agenda (`audiencias`) ya tiene su mecanismo de baja lógica completo
  (`Cancelar`/`Suspender` en `Agenda.tsx`) — queda fuera de este trabajo.

## Ficha completa de cliente

**Backend — edición.** Nuevo `PATCH /api/clientes/:id` en
`src/rutas/clientes.ts`, mismo estilo que el `POST` existente:

- 404 si el cliente no existe.
- Si el body trae `dni`, valida que no choque con el DNI de **otro** cliente
  del mismo estudio (409, mismo mensaje que ya usa el `POST`), incluyendo el
  mismo fallback de `UNIQUE constraint failed` por condición de carrera.
- `UPDATE` solo de los campos presentes en el body (nombre, apellido, dni,
  domicilio, localidad, telefono_fijo, whatsapp, email, estado, notas).
- Devuelve el cliente actualizado completo.

**Frontend — cliente API.** En `src/api/cliente.ts`:

- `Cliente` se extiende con `domicilio`, `localidad`, `telefono_fijo`, `notas`
  (el backend ya los devuelve; solo faltaba tipar).
- `crearCliente` acepta los mismos campos nuevos.
- Nuevas funciones `obtenerCliente(id)` (usa el `GET /:id` ya existente) y
  `actualizarCliente(id, datos)` (usa el `PATCH` nuevo).

**Frontend — formulario.** `FormularioNuevoCliente` en `Clientes.tsx` se
renombra a `FormularioCliente` y gana:

- Campos nuevos: Domicilio, Localidad, Teléfono fijo, Notas (textarea).
- Email pasa a estar en el formulario (ya se enviaba al crear pero no era
  editable en la UI).
- Prop opcional `cliente` para precargar valores en modo edición; internamente
  decide si llama a `crearCliente` o `actualizarCliente` según si hay `id`.

**Frontend — página de detalle.** Nueva `ClienteDetalle.tsx`
(ruta `clientes/:id` en `rutas.tsx`), mismo patrón que
`ExpedienteDetalle.tsx`: trae el cliente por id con `obtenerCliente`, muestra
todos los campos en la grilla `Dato` (reutilizando el mismo componente
`Dato`/patrón visual), sección de Notas aparte, botón "Editar" que revela
`FormularioCliente` precargado. Al guardar, recarga y vuelve a modo lectura.

**Frontend — listado.** `FilaCliente` en `Clientes.tsx` pasa a ser un `Link`
a `/clientes/:id`, igual que `FilaExpediente` en `Expedientes.tsx`. Sin
cambios visuales en la fila.

## Baja de cliente

Sin endpoint nuevo: reutiliza el `PATCH /clientes/:id` de arriba con
`{ estado: 'Inactivo' }` (`Inactivo` ya es un valor válido del `CHECK` en
`clientes.estado`).

En `ClienteDetalle.tsx`, botón "Dar de baja" que llama a `actualizarCliente`
con `estado: 'Inactivo'`; cuando el cliente ya está `Inactivo`, el botón
cambia a "Reactivar" (→ `estado: 'Activo'`). Mismo estilo visual que los
botones de transición de `FilaAudiencia` en `Agenda.tsx`.

## Baja de expediente

La tabla `expedientes` ya tiene `baja` (fecha) y `motivo_baja` (texto) sin
usar, provisionadas justo para esto.

**Backend.** Dos endpoints nuevos en `src/rutas/expedientes.ts`:

- `PATCH /api/expedientes/:id/baja` — body `{ motivo?: string }`. Valida que
  el expediente exista y pertenezca al `estudio_id` recibido (mismo patrón
  que el `GET /:id` actual). Setea `estado = 'Archivado'`,
  `baja = <fecha ISO de hoy>`, `motivo_baja = motivo ?? null`.
- `PATCH /api/expedientes/:id/reactivar` — sin body. Vuelve
  `estado = 'En trámite'`, limpia `baja` y `motivo_baja` (`NULL`).

**Frontend.** En `ExpedienteDetalle.tsx`:

- Botón "Dar de baja" que abre un campo opcional de motivo (textarea) y
  confirma; llama al endpoint de baja y recarga.
- Cuando `estado === 'Archivado'`, el botón cambia a "Reactivar".
- La grilla `Dato` muestra `Baja` y `Motivo de baja` solo cuando están
  presentes (mismo patrón que la sección de Notas condicional que ya existe
  en el componente).

Nuevas funciones en `src/api/expedientes.ts`: `darDeBajaExpediente(id, motivo?)`
y `reactivarExpediente(id)`.

## Fuera de alcance

- Borrado físico de cualquier entidad.
- Cambios de esquema de base de datos — todas las columnas necesarias ya
  existen.
- Cambios en `audiencias`/Agenda — su mecanismo de baja lógica ya está
  completo.
- Campos de cliente que no existen hoy en la tabla (CUIT, tipo de persona
  física/jurídica, fecha de nacimiento, etc.).
- RBAC sobre quién puede dar de baja o reactivar — hoy hay un solo usuario
  activo por estudio; se diseña cuando haga falta.

## Componentes tocados

### `vindexapp-api`

- `src/rutas/clientes.ts` — nuevo `PATCH /:id`.
- `src/rutas/expedientes.ts` — nuevos `PATCH /:id/baja` y `PATCH /:id/reactivar`.

### `vindexapp-frontend`

- `src/api/cliente.ts` — tipo `Cliente` extendido, `obtenerCliente`,
  `actualizarCliente`.
- `src/api/expedientes.ts` — `darDeBajaExpediente`, `reactivarExpediente`.
- `src/paginas/Clientes.tsx` — `FormularioCliente` extendido y reutilizable,
  `FilaCliente` enlaza a detalle.
- `src/paginas/ClienteDetalle.tsx` (nuevo) — detalle, edición, baja/reactivación.
- `src/paginas/ExpedienteDetalle.tsx` — botones de baja/reactivación, muestra
  `baja`/`motivo_baja`.
- `src/rutas.tsx` — ruta nueva `clientes/:id`.

## Testing

- **Backend:** `PATCH /clientes/:id` (edición parcial, 404, conflicto de DNI
  contra otro cliente, condición de carrera de UNIQUE); `PATCH
  /expedientes/:id/baja` y `/reactivar` (estado y columnas resultantes, 404
  cuando el expediente no pertenece al estudio).
- **Manual en navegador:** cargar cliente con todos los campos nuevos, editarlo,
  verificar que persiste; dar de baja y reactivar un cliente; dar de baja
  (con y sin motivo) y reactivar un expediente; confirmar que el listado de
  clientes/expedientes sigue funcionando con los registros dados de baja
  (siguen apareciendo, no desaparecen).
