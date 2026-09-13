import type { AuthContext, ServicioContext } from './middleware/auth';

/**
 * Bindings disponibles en el entorno del Worker.
 * Deben coincidir exactamente con lo declarado en wrangler.jsonc.
 */
export interface Bindings {
  DB: D1Database;
  DOCUMENTOS: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Team domain de Cloudflare Zero Trust (la parte antes de ".cloudflareaccess.com"). */
  ACCESS_TEAM_DOMINIO: string;
  /** AUD tag de la aplicación de Access que protege este Worker. No es secreto. */
  ACCESS_AUD: string;
  /** Credenciales para firmar URLs presignadas de R2 (aws4fetch) — ver src/lib/r2-firmado.ts. */
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  /**
   * estudio_id al que se mapea el Service Token de la automatización de n8n
   * (ver requireServiceAuth en src/middleware/auth.ts). VINDEX es de un solo
   * estudio hoy — si algún día hay más de uno con su propia automatización,
   * esto pasa a ser una tabla en vez de una env var.
   */
  N8N_ESTUDIO_ID: string;
  /**
   * AUD tag de la Access Application dedicada a /api/n8n ("VINDEX API - n8n").
   * Es DISTINTO del ACCESS_AUD de arriba: cada Access Application tiene su
   * propio AUD, incluso dentro del mismo dominio/team.
   */
  N8N_ACCESS_AUD: string;
  /**
   * Client ID del Service Token de Cloudflare Access creado para n8n
   * (ej. "10fc7be5847dcea4e8fcd47c0feccdbe.access"). No es el nombre lindo
   * que se le puso en el dashboard ("n8n-vindexapp") — Access pone el Client
   * ID en el claim `common_name` del JWT, no el nombre visible. No es
   * secreto: identifica el token, no lo autentica por sí solo (eso lo hace
   * el Client Secret, que nunca llega a este Worker).
   */
  N8N_SERVICE_TOKEN_CLIENT_ID: string;
}

/** Tipo de entorno de Hono compartido por los routers protegidos con requireAuth. */
export interface Env {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
}

/** Tipo de entorno de Hono exclusivo del router de integración con n8n (requireServiceAuth). */
export interface EnvServicio {
  Bindings: Bindings;
  Variables: {
    servicio: ServicioContext;
  };
}
