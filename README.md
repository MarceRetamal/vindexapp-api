# vindexapp-api

Backend de VINDEX LEGAL App. Cloudflare Worker en TypeScript, con Hono como
framework de rutas. Conecta contra la base D1 `vindexapp-interna` y el
bucket R2 `vindexapp-documentos`.

## Primer despliegue (desde VS Code, igual que el resto de los proyectos)

```bash
npm install
npx wrangler login          # solo la primera vez, si hace falta
npm run dev                 # prueba local antes de desplegar
npm run deploy               # despliega el Worker a Cloudflare
```

Después de `npm run deploy`, probar en el navegador o con curl:

```
https://vindexapp-api.<tu-subdominio>.workers.dev/api/salud
```

Debería responder algo como:

```json
{ "estado": "ok", "base_de_datos": "conectada", "estudios_registrados": 0 }
```

Si eso funciona, el Worker está bien conectado a D1.

## Estructura pensada para crecer sin volver a un archivo único

```
src/
  index.ts        -> arma la app y monta cada router
  tipos.ts         -> tipado de los bindings (D1, R2, etc.)
  rutas/            -> un archivo por entidad (clientes.ts, expedientes.ts, ...)
  db/               -> helpers de acceso a datos, si hace falta compartir lógica
```

## Cloudflare Access

Ya está activo delante de este Worker (login por credenciales de abogado,
vía Google Workspace) — configurado a nivel de Cloudflare (dashboard/zona),
no en el código del Worker. Por eso ninguna ruta de `src/rutas/` tiene su
propio middleware de autenticación: todo el tráfico pasa primero por Access.
Cualquier request sin sesión válida recibe un `302` hacia
`*.cloudflareaccess.com` antes incluso de llegar al Worker (probarlo con
`curl` sin credenciales de Access no funciona por este motivo).

## Pendiente, en orden

1. Alta del primer `estudio` y del primer `usuario` (vos) en la base, para
   poder probar rutas reales.
2. Ruta de subida de documentos a R2 (URLs firmadas, no acceso directo al
   bucket).
3. Rutas CRUD de clientes y expedientes.
4. Cifrado en reposo del chat interno.
