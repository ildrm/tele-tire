import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { db } from "../../../packages/db/src";
import { config } from "../../../packages/app/src/config";
import { runOne, sweep } from "../../../packages/app/src/jobs";
const url = new URL(config.REDIS_URL);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  password: url.password || undefined,
  maxRetriesPerRequest: null,
  ...(url.protocol === "rediss:" ? { tls: {} } : {}),
};
const queue = new Queue("teletier-wakeup", {
  connection: {
    ...connection,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  },
});
queue.on("error", () =>
  console.warn(
    JSON.stringify({
      event: "redis_unavailable",
      recovery: "PostgreSQL polling remains active",
    }),
  ),
);
let stopped = false,
  busy = false;
async function drain() {
  if (busy || stopped) return;
  busy = true;
  try {
    for (let i = 0; i < 50 && !stopped; i++) if (!(await runOne())) break;
  } catch {
    console.error(JSON.stringify({ event: "worker_database_error" }));
  } finally {
    busy = false;
  }
}
const worker = new Worker("teletier-wakeup", drain, {
  connection,
  concurrency: 1,
});
worker.on("error", () => {});
const poll = setInterval(drain, 2000);
const relay = setInterval(async () => {
  try {
    const pending = await db.job.count({
      where: { status: "PENDING", nextAt: { lte: new Date() } },
    });
    if (pending)
      await queue.add(
        "drain",
        {},
        {
          jobId: `wake-${Math.floor(Date.now() / 2000)}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
  } catch {
    /* PostgreSQL polling already provides recovery when Redis is unavailable. */
  }
}, 2000);
const periodic = setInterval(
  () =>
    sweep().catch(() =>
      console.error(JSON.stringify({ event: "sweep_failed" })),
    ),
  60000,
);
await sweep();
await drain();
console.log(
  JSON.stringify({ event: "worker_started", fake: config.TELEGRAM_FAKE }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    stopped = true;
    clearInterval(poll);
    clearInterval(periodic);
    clearInterval(relay);
    await worker.close();
    await queue.close();
    await db.$disconnect();
    process.exit(0);
  });
