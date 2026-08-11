import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function filesUnder(relative: string): Promise<string[]> {
  const entries = await readdir(`${root}/${relative}`, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("ModelGuard active runtime contract", () => {
  it("has no active API routes or market pages", async () => {
    const appFiles = await filesUnder("src/app");
    expect(appFiles.some((file) => file.includes("/api/"))).toBe(false);
    const retired = appFiles.filter((file) => /\/(market|compare|portfolio|dca|stock|tools)\//.test(file));
    for (const file of retired) expect(await readFile(`${root}/${file}`, "utf8")).toContain("redirect(");
  });

  it("does not perform network calls in active product code", async () => {
    const files = ["src/components/modelguard-home.tsx", "src/components/modelguard-workspace.tsx", "src/components/modelguard-static-page.tsx", "src/workers/model-audit.worker.ts", "src/services/modelguard-parser.ts"];
    const source = (await Promise.all(files.map((file) => readFile(`${root}/${file}`, "utf8")))).join("\n");
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/);
  });

  it("keeps the local privacy contract and provenance in the active UI", async () => {
    const source = await readFile(`${root}/src/components/modelguard-home.tsx`, "utf8");
    expect(source).toContain("modelguard.privacyLine");
    expect(await readFile(`${root}/src/domain/modelguard-schema.ts`, "utf8")).toContain("provenance");
  });
});
