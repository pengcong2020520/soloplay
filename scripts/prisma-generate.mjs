import { spawnSync } from "node:child_process";

const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_PRISMA_URL?.trim() ||
  process.env.POSTGRES_URL_NON_POOLING?.trim() ||
  process.env.POSTGRES_URL?.trim() ||
  process.env.SUPABASE_DATABASE_URL?.trim() ||
  "";

if (databaseUrl && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = databaseUrl;
}

const schema = /^postgres(?:ql)?:\/\//i.test(databaseUrl)
  ? "prisma/schema.postgres.prisma"
  : "prisma/schema.prisma";

const result = spawnSync("prisma", ["generate", "--schema", schema], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
