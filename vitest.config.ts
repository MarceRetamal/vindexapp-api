import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  test: {
    setupFiles: ['./test/aplicar-migraciones.ts'],
  },
  plugins: [
    cloudflareTest({
      main: 'src/index.ts',
      // D1/R2 son `remote: true` en wrangler.jsonc (apuntan a los recursos reales de
      // producción, detrás de Cloudflare Access). Los tests NO deben tocar eso: se
      // declara un binding DB local propio acá, en vez de leerlo de wrangler.jsonc,
      // para que corran sin login ni Access service tokens.
      miniflare: {
        compatibilityDate: '2026-08-02',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        // R2 local (no el bucket real `vindexapp-documentos`). Las credenciales de
        // firma son dummies: aws4fetch solo firma la URL localmente, no llama a AWS/R2.
        r2Buckets: ['DOCUMENTOS'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          R2_ACCESS_KEY_ID: 'test-access-key-id',
          R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
          R2_ACCOUNT_ID: 'test-account-id',
          R2_BUCKET_NAME: 'vindexapp-documentos-test',
          // Valores fijos de prueba, independientes de los reales de wrangler.jsonc,
          // para que los tests de auth no dependan de configuración de producción.
          ACCESS_TEAM_DOMINIO: 'equipo-de-prueba',
          ACCESS_AUD: 'aud-de-prueba',
          N8N_ESTUDIO_ID: 'estudio-n8n-de-prueba',
          N8N_SERVICE_TOKEN_NAME: 'n8n-vindex-de-prueba',
        },
      },
    }),
  ],
});
