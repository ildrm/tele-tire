import { spawn } from "node:child_process";
const commands = [
  ["node_modules/.bin/tsx", ["watch", "apps/api/src/main.ts"]],
  ["node_modules/.bin/next", ["dev", "apps/web", "--hostname", "127.0.0.1"]],
  ["node_modules/.bin/tsx", ["watch", "apps/worker/src/main.ts"]],
] as const;
const children = commands.map(([bin, args]) =>
  spawn(bin, [...args], { stdio: "inherit", env: process.env }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
for (const child of children)
  child.on("exit", (code) => {
    if (code && code !== 0) {
      for (const other of children) if (other !== child) other.kill();
      process.exitCode = code;
    }
  });
