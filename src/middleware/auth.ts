import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Bindings } from '../tipos';

export interface AuthContext {
  usuario_id: string;
  estudio_id: string;
  rol: string;
  email: string;
}

/**
 * Identidad de un Service Token de Cloudflare Access (ver requireServiceAuth).
 * No hay usuario_id real: un service token no es una fila de `usuarios`, es
 * una credencial máquina-a-máquina (hoy, exclusivamente la automatización de
 * n8n). Nunca usar servicio.estudio_id para ninguna columna con FK a
 * `usuarios(id)` — no existe tal fila.
 */
export interface ServicioContext {
  estudio_id: string;
  nombre: string;
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
 * devuelve el claim de identidad. No toca la base — eso lo hace requireAuth.
 *
 * Un login de usuario (Google Workspace vía Access) trae `email`. Un Service
 * Token (credencial máquina-a-máquina, ver requireServiceAuth) trae en cambio
 * `common_name` (el nombre que se le dio al token en el dashboard de Access)
 * y nunca `email`. Ambos casos son JWT igual de válidos firmados por el mismo
 * JWKS del team — la diferencia es solo qué claim de identidad traen.
 */
export async function verificarAccessJWT(
  token: string,
  jwks: JWTVerifyGetKey,
  audienciaEsperada: string
): Promise<{ email: string | null; commonName: string | null }> {
  const { payload } = await jwtVerify(token, jwks, { audience: audienciaEsperada });

  const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
  const commonName =
    typeof payload.common_name === 'string' && payload.common_name ? payload.common_name : null;

  if (!email && !commonName) {
    throw new Error('El token no incluye un email ni un common_name válido.');
  }

  return { email, commonName };
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
 *
 * Solo acepta logins de usuario (claim `email`). Un Service Token que llegue
 * acá (sin email) es rechazado con 401 — para eso está requireServiceAuth(),
 * un middleware separado y exclusivo del router de integración con n8n. No
 * se unifican los dos casos en una sola función a propósito: son superficies
 * de privilegio muy distintas (un usuario logueado vs. una automatización
 * externa) y mezclarlas facilita otorgarle a un Service Token, por error de
 * montaje, acceso a rutas de negocio que nunca debería tocar.
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
      if (!verificado.email) {
        return c.json({ error: 'No autenticado.' }, 401);
      }
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

/**
 * Middleware de Hono exclusivo del router de integración con n8n
 * (src/rutas/n8n.ts). Exige un JWT de Cloudflare Access de un Service Token
 * (claim `common_name`, nunca `email`) cuyo nombre coincida exactamente con
 * `c.env.N8N_SERVICE_TOKEN_NAME`, e inyecta { estudio_id, nombre } en el
 * contexto ("servicio").
 *
 * No consulta `usuarios` en D1: un Service Token no es un usuario, es una
 * credencial de la automatización. estudio_id sale de `c.env.N8N_ESTUDIO_ID`
 * (VINDEX es de un solo estudio hoy; si algún día hay más de uno con su
 * propia automatización, esto pasa a ser una tabla en vez de una env var).
 *
 * El chequeo de `common_name` es una capa extra de defensa en profundidad:
 * Access ya debería estar configurado con una Application dedicada a
 * `/api/n8n/*` que solo acepta ese Service Token puntual (ver CLAUDE.md), así
 * que en el camino normal ningún otro token llega hasta acá — pero si algún
 * día se agrega un segundo Service Token a la misma Application por error,
 * este chequeo evita que ese token nuevo herede acceso no pedido a esta ruta.
 */
export function requireServiceAuth(
  resolverJWKS: ResolverJWKS = obtenerJWKS
): MiddlewareHandler<{ Bindings: Bindings; Variables: { servicio: ServicioContext } }> {
  return async (c, next) => {
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) {
      return c.json({ error: 'No autenticado.' }, 401);
    }

    let commonName: string;
    try {
      const jwks = resolverJWKS(c.env.ACCESS_TEAM_DOMINIO);
      const verificado = await verificarAccessJWT(token, jwks, c.env.ACCESS_AUD);
      if (!verificado.commonName) {
        return c.json({ error: 'No autenticado.' }, 401);
      }
      commonName = verificado.commonName;
    } catch {
      return c.json({ error: 'No autenticado.' }, 401);
    }

    if (commonName !== c.env.N8N_SERVICE_TOKEN_NAME) {
      return c.json({ error: 'Service Token no reconocido.' }, 403);
    }

    c.set('servicio', {
      estudio_id: c.env.N8N_ESTUDIO_ID,
      nombre: commonName,
    });

    await next();
  };
}
