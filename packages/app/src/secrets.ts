import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config";
export const nonce = () => randomBytes(24).toString("base64url");
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function equalHash(value: string, expected: string) {
  const a = Buffer.from(hash(value), "hex"),
    b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function encrypt(token: string, context: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(config.TOKEN_ENCRYPTION_KEY, "hex"),
      iv,
    );
  cipher.setAAD(Buffer.from(`${config.TOKEN_KEY_VERSION}:${context}`));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function decrypt(value: string, context: string, keyVersion: string) {
  if (keyVersion !== config.TOKEN_KEY_VERSION)
    throw new Error("Credential key version unavailable");
  const [iv, tag, data] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(config.TOKEN_ENCRYPTION_KEY, "hex"),
    iv!,
  );
  cipher.setAAD(Buffer.from(`${keyVersion}:${context}`));
  cipher.setAuthTag(tag!);
  return Buffer.concat([cipher.update(data!), cipher.final()]).toString("utf8");
}
