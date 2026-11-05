import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("find contract", () => {
  it("frontend/src/lib/findContract.ts is identical to worker/src/find/contract.ts", () => {
    const root = join(__dirname, "..", "..");
    const worker = readFileSync(join(root, "worker", "src", "find", "contract.ts"), "utf8");
    const frontend = readFileSync(join(root, "frontend", "src", "lib", "findContract.ts"), "utf8");
    expect(frontend).toBe(worker);
  });
});
