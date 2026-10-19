import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
const database = new URL(process.env.DATABASE_URL!);
database.pathname = "/teletier_e2e";
process.env.DATABASE_URL = database.toString();
process.env.TELEGRAM_FAKE = "true";
process.env.DEV_LOGIN = "true";
Object.assign(process.env, { NODE_ENV: "test" });
const env = {
  ...process.env,
  DATABASE_URL: database.toString(),
  TELEGRAM_FAKE: "true",
  DEV_LOGIN: "true",
  APP_ORIGIN: "http://localhost:3002",
  API_PORT: "4002",
  API_INTERNAL_URL: "http://127.0.0.1:4002",
  NODE_ENV: "development",
  NEXT_DIST_DIR: ".next-e2e",
};
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 120000,
  use: {
    ...devices["Desktop Chrome"],
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    baseURL: "http://localhost:3002",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15000,
  },
  webServer: [
    {
      command: "node_modules/.bin/tsx apps/api/src/main.ts",
      url: "http://127.0.0.1:4002/api/health",
      env,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node_modules/.bin/next dev apps/web -p 3002 --hostname 127.0.0.1",
      url: "http://localhost:3002/login",
      env,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
