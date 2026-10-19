import { it, expect } from "vitest";
import { Queue, Worker } from "bullmq";
import { config } from "../packages/app/src/config";
it("real Redis/BullMQ persists and delivers a wake-up with a stable job ID", async () => {
  const url = new URL(config.REDIS_URL),
    connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      maxRetriesPerRequest: null,
    };
  const name = `teletier-test-${Date.now()}`,
    queue = new Queue(name, { connection });
  let worker: Worker | undefined;
  try {
    await queue.add(
      "drain",
      { intent: "PostgreSQL remains authoritative" },
      { jobId: "durable-wake" },
    );
    await queue.close();
    const observed = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("BullMQ delivery timed out")),
        8000,
      );
      worker = new Worker(
        name,
        async (job) => {
          expect(job.data.intent).toContain("PostgreSQL");
          return true;
        },
        { connection },
      );
      worker.on("completed", (job) => {
        clearTimeout(timer);
        resolve(job.id!);
      });
      worker.on("error", reject);
    });
    expect(await observed).toBe("durable-wake");
  } finally {
    await worker?.close();
    await queue.close();
  }
});
