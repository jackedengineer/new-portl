import { defineConfig, env } from 'prisma/config';

const migrationUrl = new URL(env('DIRECT_DATABASE_URL'));
migrationUrl.searchParams.set('schema', 'portl_auth');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: migrationUrl.toString() },
});
