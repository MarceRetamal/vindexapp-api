// `env` de 'cloudflare:test' tipa contra el namespace ambiental Cloudflare.Env, que
// solo se puebla corriendo `wrangler types` (no forma parte de este repo). En vez de
// generar ese archivo o repetir el cast en cada test, se castea una sola vez acá
// contra nuestro propio `Bindings` (src/tipos.ts), que es la fuente de verdad real.
import { env as rawEnv } from 'cloudflare:test';
import type { Bindings } from '../src/tipos';

export const env = rawEnv as unknown as Bindings;
