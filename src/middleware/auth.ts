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

// Seam exclusivo para tests: cada router en src/rutas/ llama a requireAuth()
// sin argumentos (así lo exige el diseño — ver CLAUDE.md), así que un test de
// integración que monta el router real (en vez de un Hono armado a mano) no
// tiene forma de inyectar un resolver por closure. En vez de eso, los tests
// setean acá un JWKS local antes de montar el router; obtenerJWKS lo usa si
// está presente, y así nunca sale a la red real de Cloudflare Access.
// Ver test/auth.ts (_establecerJWKSDePruebaParaTests).
let jwksDePruebaParaTests: JWTVerifyGetKey | undefined;

/** SOLO para tests: fuerza a obtenerJWKS a devolver un JWKS local en vez de salir a la red. */
export function _establecerJWKSDePruebaParaTests(jwks: JWTVerifyGetKey | undefined): void {
  jwksDePruebaParaTests = jwks;
}

/** JWKS real de Cloudflare Access, cacheado en memoria del Worker. */
export function obtenerJWKS(teamDominio: string): JWTVerifyGetKey {
  if (jwksDePruebaParaTests) return jwksDePruebaParaTests;

  const existente = cacheJWKS.get(teamDominio);
  if (existente) return existente;

  const jwks = createRemoteJWKSet(
    new URL(`https://${teamDominio}.cloudflareaccess.com/cdn-cgi/access/certs`)
  );
  cacheJWKS.set(teamDominio, jwks);
  return jwks;
}

/**
 * Verifica un JWT de Cloudflare Access (firma, audiencia, expiración) y
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
 * Middleware de Hono: exige un JWT de Cloudflare Access válido (header
 * `Cf-Access-Jwt-Assertion`, que Access agrega a cada request en el borde),
 * resuelve el usuario en D1 por email, e inyecta
 * { usuario_id, estudio_id, rol, email } en el contexto ("auth").
 *
 * Se verifica el JWT manualmente (en vez de depender de `ctx.access`, la API
 * nativa de Cloudflare) por dos motivos: (1) `ctx.access` no está disponible
 * en el entorno de test (vitest-pool-workers/Miniflare no simula el borde de
 * Access), así que no se puede escribir un test de aislamiento real contra
 * ella; (2) el fallback `*.workers.dev` de un Worker no queda protegido por
 * Access, así que conviene no confiar únicamente en el filtrado del borde.
 * resolverJWKS es inyectable para poder testear sin red (ver auth.test.ts).
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
