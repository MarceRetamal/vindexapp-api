import type { AuthContext } from './middleware/auth';

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
}

/** Tipo de entorno de Hono compartido por los routers protegidos con requireAuth. */
export interface Env {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
}
