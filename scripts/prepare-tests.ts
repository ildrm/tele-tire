import "dotenv/config";
import { spawnSync } from "node:child_process";
import { db } from "../packages/db/src";
const base = new URL(process.env.DATABASE_URL!);
for (const name of ["teletier_test", "teletier_e2e"]) {
  const existing = await db.$queryRaw<
    { datname: string }[]
  >`SELECT datname FROM pg_database WHERE datname=${name}`;
  if (!existing.length) await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const child = spawnSync(
    "node_modules/.bin/prisma",
    ["migrate", "deploy", "--schema", "packages/db/schema.prisma"],
    { stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString() } },
  );
  if (child.status !== 0) process.exit(child.status ?? 1);
}
await db.$disconnect();
