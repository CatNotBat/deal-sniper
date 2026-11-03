import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const srcDir = new URL("../src", import.meta.url).pathname;

describe("src files avoid dangerous HTML APIs", () => {
  for (const file of tsFiles(srcDir)) {
    it(`${file} is clean`, () => {
      const text = readFileSync(file, "utf8");
      for (const bad of FORBIDDEN) {
        expect(text, `contains ${bad}`).not.toContain(bad);
      }
    });
  }
});
