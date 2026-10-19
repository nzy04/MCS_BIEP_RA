import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { noteFolders } from "../shared/directions.ts";
const root = path.resolve(process.argv[2] || ".");
const read = (name) => JSON.parse(readFileSync(path.join(root, name), "utf8"));
const index = read("data/library.json");
assert.ok(Array.isArray(index.notes), "data/library.json must contain notes");
const seen = new Set(),
  assets = new Set();
for (const summary of index.notes) {
  assert.match(
    summary.id,
    /^note-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  assert.ok(!seen.has(summary.id), `Duplicate note ${summary.id}`);
  seen.add(summary.id);
  const note = read(`data/notes/${summary.id}.json`);
  for (const field of [
    "id",
    "title",
    "tags",
    "revision",
    "author",
    "authorLogin",
    "createdAt",
    "updatedAt",
  ])
    assert.deepEqual(
      note[field],
      summary[field],
      `Index mismatch ${summary.id}: ${field}`,
    );
  for (const folder of noteFolders(note.tags)) {
    // Older flat reading copies remain valid until the note is edited or moved.
    assert.ok(
      existsSync(path.join(root, `${folder}/${note.id}.md`)) ||
        existsSync(path.join(root, `papers/${note.id}.md`)),
      `Missing reading copy ${note.id}`,
    );
  }
  for (const asset of note.assets || []) {
    assert.ok(
      asset.path.startsWith(`assets/uploads/${note.id}/`) &&
        /^[-a-zA-Z0-9.]+$/.test(asset.path.split("/").pop()),
      `Invalid asset path ${asset.path}`,
    );
    const file = path.resolve(root, asset.path);
    assert.ok(file.startsWith(root + path.sep));
    assert.ok(existsSync(file), `Missing asset ${asset.path}`);
    assert.equal(
      statSync(file).size,
      asset.size,
      `Asset size mismatch ${asset.path}`,
    );
    assets.add(asset.path);
  }
  assert.ok(
    !JSON.stringify(note).includes('"dataUrl"'),
    `Embedded upload data in ${note.id}`,
  );
}
const noteRoot = path.join(root, "data/notes");
if (existsSync(noteRoot))
  for (const file of readdirSync(noteRoot))
    if (file.endsWith(".json"))
      assert.ok(seen.has(file.slice(0, -5)), `Unindexed note ${file}`);
console.log(
  JSON.stringify({
    notes: seen.size,
    referencedAssets: assets.size,
    integrity: "passed",
  }),
);
