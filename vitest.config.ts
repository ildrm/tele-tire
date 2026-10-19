import { defineConfig } from "vitest/config";
import { config as dotenv } from "dotenv";
dotenv();
// Integration tests only use the explicitly named disposable test database.
const base = new URL(
  process.env.DATABASE_URL ??
    "postgresql://teletier:teletier@127.0.0.1:5432/teletier",
);
base.pathname = "/teletier_test";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: base.toString(),
      NODE_ENV: "test",
      DEV_LOGIN: "true",
      TELEGRAM_FAKE: "true",
      TOKEN_ENCRYPTION_KEY: "1".repeat(64),
      VITEST: "true",
    },
  },
});
