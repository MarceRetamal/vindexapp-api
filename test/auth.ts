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
import type { Env } from '../src/tipos';

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
 * Monta un router individual. El router ya trae su propio requireAuth() (así
 * lo exige el diseño de cada archivo en src/rutas/); acá solo nos aseguramos
 * de que ese requireAuth() resuelva contra el JWKS local de prueba en vez de
 * salir a la red real de Cloudflare Access.
 */
export async function crearAppAutenticada(router: Hono<Env>): Promise<Hono<Env>> {
  await asegurarClaves();
  const app = new Hono<Env>();
  app.route('/', router);
  return app;
}
