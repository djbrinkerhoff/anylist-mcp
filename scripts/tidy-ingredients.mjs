#!/usr/bin/env node
// Keeps recipe ingredient lines tidy: an agent exports recently added recipes,
// decides the fixes (see docs/ingredient-tidy-prompt.md), and applies them.
//
// Usage (run from the repo root, with ANYLIST_USERNAME, ANYLIST_PASSWORD and
// ANYLIST_LIST_NAME set, e.g. `node --env-file=.env scripts/tidy-ingredients.mjs ...`):
//   export [--since YYYY-MM-DD] [--out file]   recipes added since the last run, plus the name vocabulary
//   apply <changes.json> [--dry-run]           back up the touched recipes, then apply the changes
//   restore <backup.json>                      put backed-up recipes' ingredients back exactly
//
// State and backups live in ~/.anylist-tidy/ (override with ANYLIST_TIDY_DIR).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import AnyListClient from "../src/anylist-client.js";

const dir = process.env.ANYLIST_TIDY_DIR || join(homedir(), ".anylist-tidy");
const statePath = join(dir, "state.json");
const [command, ...args] = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? true; };

function usage() {
  console.error("Usage: node scripts/tidy-ingredients.mjs export [--since YYYY-MM-DD] [--out file] | apply <changes.json> [--dry-run] | restore <backup.json>");
  process.exit(1);
}
if (!["export", "apply", "restore"].includes(command)) usage();

mkdirSync(dir, { recursive: true });
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const client = new AnyListClient({ connectWebSocket: false });
await client.connect();
const recipes = await client.client.getRecipes();

try {
  if (command === "export") {
    // Default window: since the last applied run, else the last 7 days.
    const since = flag("--since") ? new Date(flag("--since")) : new Date(state.lastRun || Date.now() - 7 * 864e5);
    // Only the creation time: the other timestamp changes on every edit.
    const created = r => new Date((r.creationTimestamp || 0) * 1000);
    const lines = r => r.ingredients.map(i => i.toJSON()).map(i => ({
      text: i.rawIngredient || "", name: i.name || "", quantity: i.quantity || "", note: i.note || "", isHeading: !!i.isHeading,
    }));

    // The vocabulary: names already used across all recipes, most used first,
    // so new lines reuse them ("scallions", not "green onions").
    const counts = new Map();
    for (const r of recipes) for (const i of r.ingredients) {
      if (i.name && !i.toJSON().isHeading) counts.set(i.name, (counts.get(i.name) || 0) + 1);
    }
    const vocabulary = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

    const out = {
      exportedAt: new Date().toISOString(),
      since: since.toISOString(),
      recipes: recipes.filter(r => created(r) >= since)
        .map(r => ({ id: r.identifier, name: r.name, created: created(r).toISOString(), lines: lines(r) })),
      vocabulary,
    };
    const json = JSON.stringify(out, null, 1);
    if (flag("--out")) writeFileSync(flag("--out"), json); else console.log(json);
    console.error(`${out.recipes.length} recipes added since ${out.since.slice(0, 10)}; vocabulary of ${vocabulary.length} names`);
  }

  if (command === "apply") {
    if (!args[0]) usage();
    const { exportedAt, changes = [] } = JSON.parse(readFileSync(args[0], "utf8"));
    if (!exportedAt) throw new Error("changes file needs the exportedAt value from the export it was based on");
    const ids = [...new Set(changes.map(c => c.recipe_id))];
    const backupPath = join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

    if (flag("--dry-run")) {
      console.log(`Would change ${changes.length} lines in ${ids.length} recipes; nothing saved.`);
    } else {
      if (changes.length) {
        const backup = {};
        for (const id of ids) {
          const r = recipes.find(x => x.identifier === id);
          if (r) backup[id] = r.ingredients.map(i => i.toJSON());
        }
        writeFileSync(backupPath, JSON.stringify(backup));
        console.log(`Backed up ${Object.keys(backup).length} recipes to ${backupPath}`);
      }
      const result = changes.length ? await client.updateIngredients(changes.map(c => ({
        recipeId: c.recipe_id, match: c.match, text: c.text, name: c.name, quantity: c.quantity, note: c.note, isHeading: c.is_heading,
      }))) : { recipesSaved: 0, linesChanged: 0, unmatched: [] };
      // The next export starts where this one left off.
      writeFileSync(statePath, JSON.stringify({ ...state, lastRun: exportedAt }, null, 1));
      console.log(`Changed ${result.linesChanged} lines in ${result.recipesSaved} recipes.`);
      for (const u of result.unmatched) console.log(`Not changed: ${u.recipeId} "${u.match}" (${u.reason})`);
    }
  }

  if (command === "restore") {
    if (!args[0]) usage();
    const backup = JSON.parse(readFileSync(args[0], "utf8"));
    let n = 0;
    for (const [id, ingredients] of Object.entries(backup)) {
      const r = recipes.find(x => x.identifier === id);
      if (!r) { console.log(`Skipped ${id}: recipe not found`); continue; }
      const fields = client._recipeFields(r);
      fields.ingredients = ingredients;
      await (await client.client.createRecipe(fields)).save();
      n++;
    }
    console.log(`Restored ${n} recipes from ${args[0]}`);
  }
} finally {
  await client.disconnect();
}
