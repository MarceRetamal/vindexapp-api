// Corre dentro del runtime del Worker (setupFiles de vitest-pool-workers), una vez
// por archivo de test. Aplica el esquema real de migrations/ contra la base D1 en
// memoria de miniflare, para que los tests de integración corran contra el mismo
// esquema que producción sin tener que mantener un esquema de test paralelo.
import { applyD1Migrations, env as rawEnv, type D1Migration } from 'cloudflare:test';
import type { Bindings } from '../src/tipos';

const env = rawEnv as unknown as Bindings & { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
