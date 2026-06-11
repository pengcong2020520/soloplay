import { spawnSync } from "node:child_process";

const runtimeDatabaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_PRISMA_URL?.trim() ||
  process.env.POSTGRES_URL_NON_POOLING?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  process.env.SUPABASE_DATABASE_URL?.trim() ||
  "";

if (runtimeDatabaseUrl && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = runtimeDatabaseUrl;
}

const isPostgres = /^postgres(?:ql)?:\/\//i.test(runtimeDatabaseUrl);
const schema = isPostgres ? "prisma/schema.postgres.prisma" : "prisma/schema.prisma";
const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL_NON_POOLING?.trim() ||
  process.env.DIRECT_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  runtimeDatabaseUrl;

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("prisma", ["generate", "--schema", schema]);

if (!isPostgres) {
  console.warn("Skipping Vercel database preparation because DATABASE_URL is not Postgres.");
  process.exit(0);
}

process.env.DATABASE_URL = migrationDatabaseUrl;
run("prisma", ["db", "push", "--schema", schema, "--skip-generate"]);
run("prisma", ["db", "execute", "--schema", schema, "--file", "prisma/supabase-rls.sql"]);
process.env.DATABASE_URL = runtimeDatabaseUrl;
run("tsx", ["prisma/seed.ts"]);
