-- ============================================================
-- VINDEX LEGAL APP — Esquema inicial (Cloudflare D1 / SQLite)
-- Migración: 001_esquema_inicial
-- ============================================================
-- Convenciones:
--  * Toda tabla lleva estudio_id: aislamiento multi-estudio desde el día uno.
--  * Claves primarias: TEXT (uuid generado en el Worker), no autoincrement,
--    para poder generarlas del lado del cliente/Worker sin ida y vuelta.
--  * Fechas de negocio (inicio de expediente, fecha de audiencia, etc.):
--    TEXT en formato ISO 'YYYY-MM-DD'.
--  * Timestamps de sistema (creado_en, actualizado_en): INTEGER, epoch ms.
--  * Montos: INTEGER, en centavos, para evitar errores de coma flotante.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- 1. IDENTIDAD Y ACCESO ----------

CREATE TABLE estudios (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,           -- ej. "VINDEX LEGAL"
  cuit          TEXT,
  matricula     TEXT,                    -- ej. "T° LXVI · F° 263 · CALP"
  domicilio     TEXT,
  localidad     TEXT,
  creado_en     INTEGER NOT NULL,
  activo        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE usuarios (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  nombre        TEXT NOT NULL,
  apellido      TEXT NOT NULL,
  dni           TEXT,
  domicilio     TEXT,
  localidad     TEXT,
  telefono_fijo TEXT,                    -- opcional
  whatsapp      TEXT,
  email         TEXT NOT NULL UNIQUE,    -- coincide con la identidad de Cloudflare Access
  rol           TEXT NOT NULL CHECK (rol IN ('titular','asociado','administrativo')),
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_usuarios_estudio ON usuarios(estudio_id);

-- ---------- 2. CLIENTES Y EXPEDIENTES ----------

CREATE TABLE clientes (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  nombre        TEXT NOT NULL,
  apellido      TEXT NOT NULL,
  dni           TEXT,
  domicilio     TEXT,
  localidad     TEXT,
  telefono_fijo TEXT,
  whatsapp      TEXT,
  email         TEXT,
  estado        TEXT NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo','Potencial','Inactivo')),
  notas         TEXT,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_clientes_estudio ON clientes(estudio_id);

CREATE TABLE expedientes (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  cliente_id    TEXT NOT NULL REFERENCES clientes(id),
  caratula      TEXT NOT NULL,
  numero        TEXT,
  fuero         TEXT,
  juzgado       TEXT,
  departamento  TEXT,                    -- departamento judicial (PBA)
  rol_procesal  TEXT,                    -- Actora / Demandada / etc.
  estado        TEXT NOT NULL DEFAULT 'En trámite',
  inicio        TEXT,
  baja          TEXT,
  motivo_baja   TEXT,
  notas         TEXT,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_expedientes_estudio  ON expedientes(estudio_id);
CREATE INDEX idx_expedientes_cliente  ON expedientes(cliente_id);

-- Prevista para más adelante: múltiples partes vinculadas a un mismo expediente
-- (p. ej. otro cliente propio como codemandado en la misma causa).
-- No se activa en esta fase; se documenta para no romper el diseño después.
-- CREATE TABLE expediente_partes (
--   id            TEXT PRIMARY KEY,
--   expediente_id TEXT NOT NULL REFERENCES expedientes(id),
--   cliente_id    TEXT NOT NULL REFERENCES clientes(id),
--   rol_procesal  TEXT
-- );

CREATE TABLE requisitos_ingreso (
  id            TEXT PRIMARY KEY,
  expediente_id TEXT NOT NULL REFERENCES expedientes(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('bono','jus')),
  pagado        INTEGER NOT NULL DEFAULT 0,
  monto         INTEGER,                 -- centavos
  fecha         TEXT,
  UNIQUE(expediente_id, tipo)
);

-- ---------- 3. DOCUMENTACIÓN ----------

CREATE TABLE documentos (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  cliente_id    TEXT REFERENCES clientes(id),
  expediente_id TEXT REFERENCES expedientes(id),   -- nullable: documentos de estudio sin expediente
  categoria     TEXT NOT NULL CHECK (categoria IN (
                  'escrito_judicial','resolucion','presupuesto','estrategia',
                  'planilla','template','factura','captura','otro'
                )),
  nombre        TEXT NOT NULL,
  extension     TEXT NOT NULL,
  ruta_r2       TEXT NOT NULL UNIQUE,    -- clave del objeto en el bucket R2
  tamano_bytes  INTEGER,
  cargado_por   TEXT REFERENCES usuarios(id),
  notas         TEXT,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_documentos_estudio    ON documentos(estudio_id);
CREATE INDEX idx_documentos_expediente ON documentos(expediente_id);
CREATE INDEX idx_documentos_cliente    ON documentos(cliente_id);

CREATE TABLE presupuestos (
  id                TEXT PRIMARY KEY,
  estudio_id        TEXT NOT NULL REFERENCES estudios(id),
  cliente_id        TEXT REFERENCES clientes(id),      -- nulo: aún no es cliente formal
  contacto_nombre   TEXT,                                -- para potenciales clientes sin ficha
  contacto_telefono TEXT,
  expediente_id     TEXT REFERENCES expedientes(id),    -- se completa recién al firmarse
  documento_id      TEXT REFERENCES documentos(id),     -- PDF del presupuesto, si existe
  concepto          TEXT NOT NULL,
  monto             INTEGER NOT NULL,                    -- centavos
  estado            TEXT NOT NULL DEFAULT 'borrador'
                     CHECK (estado IN ('borrador','enviado','firmado','rechazado','vencido')),
  fecha_emision     TEXT,
  fecha_firma       TEXT,
  creado_en         INTEGER NOT NULL
);
CREATE INDEX idx_presupuestos_estudio  ON presupuestos(estudio_id);
CREATE INDEX idx_presupuestos_cliente  ON presupuestos(cliente_id);

CREATE TABLE estrategias (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  expediente_id TEXT NOT NULL REFERENCES expedientes(id),  -- vinculada al expediente, no al cliente
  titulo        TEXT NOT NULL,
  contenido     TEXT,
  creado_por    TEXT REFERENCES usuarios(id),
  creado_en     INTEGER NOT NULL,
  actualizado_en INTEGER
);
CREATE INDEX idx_estrategias_expediente ON estrategias(expediente_id);

CREATE TABLE templates (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  nombre        TEXT NOT NULL,
  categoria     TEXT,                    -- ej. "escrito", "presupuesto", "contrato de honorarios"
  documento_id  TEXT REFERENCES documentos(id),
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_templates_estudio ON templates(estudio_id);

-- ---------- 4. ACTIVIDAD PROCESAL ----------

CREATE TABLE actuaciones (
  id              TEXT PRIMARY KEY,
  estudio_id      TEXT NOT NULL REFERENCES estudios(id),
  expediente_id   TEXT NOT NULL REFERENCES expedientes(id),
  tipo            TEXT NOT NULL,
  fecha           TEXT NOT NULL,
  detalle_interno TEXT,
  texto_cliente   TEXT,
  visible         INTEGER NOT NULL DEFAULT 0,   -- visible para el cliente en su vista
  notificado      INTEGER NOT NULL DEFAULT 0,   -- ya publicada/notificada al cliente
  hito            INTEGER NOT NULL DEFAULT 0,
  documento_id    TEXT REFERENCES documentos(id),
  creado_por      TEXT REFERENCES usuarios(id),
  creado_en       INTEGER NOT NULL
);
CREATE INDEX idx_actuaciones_expediente ON actuaciones(expediente_id);

CREATE TABLE audiencias (
  id              TEXT PRIMARY KEY,
  estudio_id      TEXT NOT NULL REFERENCES estudios(id),
  expediente_id   TEXT NOT NULL REFERENCES expedientes(id),
  tipo            TEXT NOT NULL,
  fecha           TEXT NOT NULL,
  hora            TEXT,
  modalidad       TEXT CHECK (modalidad IN ('Presencial','Videoconferencia','Telefónica')),
  lugar           TEXT,
  estado          TEXT NOT NULL DEFAULT 'Programada'
                   CHECK (estado IN ('Programada','Realizada','Suspendida','Cancelada')),
  recordatorio        INTEGER NOT NULL DEFAULT 1,
  recordatorio_enviado INTEGER NOT NULL DEFAULT 0,
  creado_en       INTEGER NOT NULL
);
CREATE INDEX idx_audiencias_expediente ON audiencias(expediente_id);
CREATE INDEX idx_audiencias_fecha      ON audiencias(fecha);

-- ---------- 5. DINERO Y COMUNICACIÓN ----------

CREATE TABLE movimientos (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  cliente_id    TEXT REFERENCES clientes(id),
  expediente_id TEXT REFERENCES expedientes(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria     TEXT NOT NULL,
  detalle       TEXT,
  monto         INTEGER NOT NULL,        -- centavos
  medio         TEXT,
  comprobante   TEXT,
  fecha         TEXT NOT NULL,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_movimientos_estudio    ON movimientos(estudio_id);
CREATE INDEX idx_movimientos_cliente    ON movimientos(cliente_id);
CREATE INDEX idx_movimientos_expediente ON movimientos(expediente_id);

-- Fase 2 (integración ARCA/ex AFIP). Estructura mínima prevista ahora
-- para no romper el resto del sistema cuando se active la integración.
CREATE TABLE facturas (
  id            TEXT PRIMARY KEY,
  estudio_id    TEXT NOT NULL REFERENCES estudios(id),
  cliente_id    TEXT REFERENCES clientes(id),
  expediente_id TEXT REFERENCES expedientes(id),
  numero        TEXT,
  cae           TEXT,                    -- Comprobante Autorización Electrónica (ARCA)
  monto         INTEGER NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','emitida','cobrada','anulada')),
  documento_id  TEXT REFERENCES documentos(id),
  fecha         TEXT,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_facturas_estudio ON facturas(estudio_id);

-- Chat interno cifrado abogado-cliente. Sin columnas de canal externo:
-- no hay salida a WhatsApp, n8n ni ningún servicio de mensajería de terceros.
CREATE TABLE mensajes (
  id                TEXT PRIMARY KEY,
  estudio_id        TEXT NOT NULL REFERENCES estudios(id),
  cliente_id        TEXT NOT NULL REFERENCES clientes(id),
  usuario_id        TEXT REFERENCES usuarios(id),   -- abogado interviniente, si el mensaje es 'out'
  direccion         TEXT NOT NULL CHECK (direccion IN ('in','out')),
  contenido_cifrado BLOB NOT NULL,                  -- cifrado en reposo, gestionado por el Worker
  leido             INTEGER NOT NULL DEFAULT 0,
  creado_en         INTEGER NOT NULL
);
CREATE INDEX idx_mensajes_cliente ON mensajes(cliente_id);
CREATE INDEX idx_mensajes_estudio ON mensajes(estudio_id);
