import { createHash } from "node:crypto";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { db } from "../../db/src";
import { config } from "./config";
import { hash, nonce } from "./secrets";
import { requireThat, telegramId } from "../../domain/src";
export type Actor = {
  userId: string;
  telegramId: bigint;
  tenantId: string;
  role: string;
};
const jwks = createRemoteJWKSet(
  new URL("https://oauth.telegram.org/.well-known/jwks.json"),
  { timeoutDuration: 4000 },
);
export async function verifyIdentity(
  token: string,
  expectedNonce: string,
  key: JWTVerifyGetKey = jwks,
  audience = config.OIDC_CLIENT_ID,
) {
  const { payload } = await jwtVerify(token, key, {
    issuer: "https://oauth.telegram.org",
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat", "nonce", "id"],
    maxTokenAge: "1h",
    clockTolerance: 5,
  });
  requireThat(payload.nonce === expectedNonce, 401, "Invalid login nonce");
  requireThat(
    typeof payload.sub === "string" &&
      payload.sub.length > 0 &&
      payload.sub.length < 200,
    401,
    "Invalid identity subject",
  );
  const id = telegramId.parse(String(payload.id));
  return {
    subject: payload.sub,
    telegramId: BigInt(id),
    name:
      typeof payload.name === "string" ? payload.name.slice(0, 100) : "Creator",
  };
}
export function cookies(raw: string | undefined) {
  return Object.fromEntries(
    (raw ?? "")
      .split(";")
      .filter((v) => v.includes("="))
      .map((v) => {
        const i = v.indexOf("=");
        return [v.slice(0, i).trim(), v.slice(i + 1)];
      }),
  );
}
export function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export async function createSession(identity: {
  subject: string;
  telegramId: bigint;
  name: string;
}) {
  const user = await db.user.upsert({
    where: { subject: identity.subject },
    create: identity,
    update: { name: identity.name },
  });
  requireThat(
    user.telegramId === identity.telegramId,
    401,
    "Identity changed; contact support",
  );
  const token = nonce(),
    csrf = nonce();
  await db.session.create({
    data: {
      id: hash(token),
      userId: user.id,
      csrf,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  return { token, csrf, user };
}
export async function getSession(rawCookie: string | undefined) {
  const raw = cookies(rawCookie).tt_session;
  requireThat(raw && raw.length < 200, 401, "Sign in to continue");
  const session = await db.session.findUnique({
    where: { id: hash(raw) },
    include: { user: { include: { members: { include: { tenant: true } } } } },
  });
  requireThat(
    session && session.expiresAt > new Date(),
    401,
    "Session expired; sign in again",
  );
  return session;
}
export async function actorFor(
  rawCookie: string | undefined,
  tenantId?: string,
): Promise<Actor> {
  const session = await getSession(rawCookie);
  const member = tenantId
    ? session.user.members.find((m) => m.tenantId === tenantId)
    : session.user.members[0];
  requireThat(member, 403, "No authorized workspace selected");
  return {
    userId: session.userId,
    telegramId: session.user.telegramId,
    tenantId: member.tenantId,
    role: member.role,
  };
}
export function owner(actor: Actor) {
  requireThat(
    actor.role === "OWNER",
    403,
    "Workspace owner permission required",
  );
}
export async function loginStart() {
  requireThat(
    config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET,
    503,
    "Configure the platform Telegram login client before signing in",
  );
  const state = nonce(),
    verifier = nonce() + nonce(),
    n = nonce();
  await db.authAttempt.create({
    data: {
      id: hash(state),
      verifier,
      nonce: n,
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const url = new URL("https://oauth.telegram.org/auth");
  url.search = new URLSearchParams({
    client_id: config.OIDC_CLIENT_ID,
    redirect_uri: config.OIDC_REDIRECT_URI,
    response_type: "code",
    scope: "openid profile",
    state,
    nonce: n,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { state, url: url.toString() };
}
export async function loginCallback(
  code: string,
  state: string,
  rawCookie: string | undefined,
) {
  requireThat(
    state &&
      state.length < 200 &&
      code &&
      code.length < 4096 &&
      cookies(rawCookie).tt_login === state,
    401,
    "Invalid login state",
  );
  const attempt = await db.authAttempt.findUnique({
    where: { id: hash(state) },
  });
  requireThat(
    attempt && attempt.expiresAt > new Date(),
    401,
    "Login expired; start again",
  );
  const consumed = await db.authAttempt.deleteMany({
    where: { id: attempt.id },
  });
  requireThat(consumed.count === 1, 401, "Login already used");
  const response = await fetch("https://oauth.telegram.org/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${config.OIDC_CLIENT_ID}:${config.OIDC_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.OIDC_REDIRECT_URI,
      client_id: config.OIDC_CLIENT_ID,
      code_verifier: attempt.verifier,
    }),
    signal: AbortSignal.timeout(5000),
  });
  requireThat(response.ok, 401, "Telegram login exchange failed");
  const data = (await response.json()) as JWTPayload;
  requireThat(typeof data.id_token === "string", 401, "Missing identity token");
  return createSession(await verifyIdentity(data.id_token, attempt.nonce));
}
