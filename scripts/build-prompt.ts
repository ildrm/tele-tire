import { readFileSync, writeFileSync } from "node:fs";
const original = readFileSync("docs/source-prompt.md", "utf8");
const extension = readFileSync("docs/implementation-extension.md", "utf8");
writeFileSync(
  "docs/IMPLEMENTATION_PROMPT.md",
  `# TeleTier — expanded, self-contained implementation prompt\n\nThe original requirements follow, with a normative clarification appendix at the end. Read both before implementing. The appendix resolves ambiguous technical choices; it does not waive payment, access, tenant-isolation or release-verification gates.\n\n${original}\n\n---\n\n${extension}`,
);
console.log(
  "Built docs/IMPLEMENTATION_PROMPT.md from the preserved source and extension.",
);
