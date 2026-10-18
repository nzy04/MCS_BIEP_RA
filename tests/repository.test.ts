import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

test("public source excludes local profile paths and embedded credentials", () => {
  const files = ["README.md", "wrangler.jsonc", ".dev.vars.example", "package.json",
    ...["src", "shared", "worker", ".github"].flatMap(sourceFiles)];
  const patterns = [
    /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+/i,
    /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\//,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    /\bsk-[A-Za-z0-9]{32,}\b/,
  ];
  const findings: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (patterns.some(pattern => pattern.test(text))) findings.push(relative(process.cwd(), file));
  }
  assert.deepEqual(findings, [], "Remove local paths or credentials from the listed public files.");
});
