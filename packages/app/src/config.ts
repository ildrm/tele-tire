import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.url().default("redis://127.0.0.1:6379"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
  PUBLIC_WEBHOOK_ORIGIN: z.url().default("https://localhost.invalid"),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  TOKEN_KEY_VERSION: z.string().default("local-v1"),
  DEV_LOGIN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TELEGRAM_FAKE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TELEGRAM_ENV: z.enum(["production", "test"]).default("production"),
  DEV_OWNER_TELEGRAM_ID: z.string().default("100001"),
  OIDC_CLIENT_ID: z.string().default(""),
  OIDC_CLIENT_SECRET: z.string().default(""),
  OIDC_REDIRECT_URI: z.url().default("http://localhost:3000/api/auth/callback"),
  OPERATOR_TELEGRAM_IDS: z.string().default(""),
  INBOX_RETENTION_DAYS: z.coerce.number().int().min(7).default(30),
});
export const config = schema.parse(process.env);
if (config.NODE_ENV === "production") {
  if (config.DEV_LOGIN || config.TELEGRAM_FAKE)
    throw new Error("Development fixtures are forbidden in production");
  if (
    !config.APP_ORIGIN.startsWith("https:") ||
    !config.PUBLIC_WEBHOOK_ORIGIN.startsWith("https:")
  )
    throw new Error("Production requires HTTPS");
  if (!config.OIDC_CLIENT_ID || !config.OIDC_CLIENT_SECRET)
    throw new Error("Production requires Telegram OIDC");
}
