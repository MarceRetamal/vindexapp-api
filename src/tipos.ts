/**
 * Bindings disponibles en el entorno del Worker.
 * Deben coincidir exactamente con lo declarado en wrangler.jsonc.
 */
export interface Bindings {
  DB: D1Database;
  DOCUMENTOS: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Se suman acá, a medida que se agreguen: la clave de cifrado del chat,
  // el binding de Cloudflare Access, etc.
}
