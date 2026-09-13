// Helper compartido por los tests de integración de rutas protegidas con
// requireAuth. SELF.fetch (contra el Worker completo de src/index.ts) no
// sirve para estos tests porque requireAuth(), sin resolver inyectado, usa
// el JWKS remoto real de Cloudflare Access (inalcanzable en el sandbox de
// test) — por eso acá se monta cada router individualmente, con un JWKS de
// prueba generado en memoria e inyectado directamente.
import { Hono } from 'hono';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import type { D1Database } from '@cloudflare/workers-types';
import { _establecerJWKSDePruebaParaTests } from '../src/middleware/auth';
import type { Bindings } from '../src/tipos';

let jwks: JWTVerifyGetKey | undefined;
let privateKey: CryptoKey | undefined;

async function asegurarClaves() {
  if (jwks && privateKey) return;
  const par = await generateKeyPair('RS256');
  privateKey = par.privateKey;
  const jwk = await exportJWK(par.publicKey);
  jwk.kid = 'clave-de-prueba';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwks = createLocalJWKSet({ keys: [jwk] });
  // Los routers reales llaman a requireAuth() sin resolver inyectado, así que
  // el seam de prueba se setea acá (ver comentario en middleware/auth.ts).
  _establecerJWKSDePruebaParaTests(jwks);
}

export async function firmarTokenDePrueba(email: string): Promise<string> {
  await asegurarClaves();
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience('aud-de-prueba')
    .setExpirationTime(ahora + 300)
    .sign(privateKey!);
}

/**
 * Firma un JWT "de Service Token" para requireServiceAuth (claim
 * common_name, sin email) — ver test de n8n.ts. commonName debe coincidir
 * con N8N_SERVICE_TOKEN_NAME de vitest.config.ts para pasar el chequeo de
 * requireServiceAuth, salvo que el test pruebe explícitamente el caso 403.
 */
export async function firmarTokenDeServicioDePrueba(commonName: string): Promise<string> {
  await asegurarClaves();
  const ahora = Math.floor(Date.now() / 1000);
  return new SignJWT({ common_name: commonName })
    .setProtectedHeader({ alg: 'RS256', kid: 'clave-de-prueba' })
    .setIssuedAt(ahora)
    .setAudience('aud-de-prueba')
    .setExpirationTime(ahora + 300)
    .sign(privateKey!);
}

/** Crea un usuario titular en el estudio dado y devuelve un token de Access válido para él. */
export async function crearUsuarioAutenticado(
  db: D1Database,
  estudioId: string,
  email: string = `usuario-${crypto.randomUUID()}@vindexlegal.com.ar`
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO usuarios (id, estudio_id, nombre, apellido, email, rol, activo, creado_en)
       VALUES (?, ?, 'Usuario', 'De Prueba', ?, 'titular', 1, ?)`
    )
    .bind(crypto.randomUUID(), estudioId, email, Date.now())
    .run();
  return firmarTokenDePrueba(email);
}

/**
 * Monta un router individual. El router ya trae su propio requireAuth() o
 * requireServiceAuth() (así lo exige el diseño de cada archivo en
 * src/rutas/); acá solo nos aseguramos de que ese middleware resuelva contra
 * el JWKS local de prueba en vez de salir a la red real de Cloudflare
 * Access. Genérico sobre el tipo de entorno para servir tanto a los routers
 * de negocio (Env/AuthContext) como al de integración con n8n
 * (EnvServicio/ServicioContext).
 */
export async function crearAppAutenticada<E extends { Bindings: Bindings }>(
  router: Hono<E>
): Promise<Hono<E>> {
  await asegurarClaves();
  const app = new Hono<E>();
  app.route('/', router);
  return app;
}
