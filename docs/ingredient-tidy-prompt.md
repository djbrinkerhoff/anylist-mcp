# Ingredient tidy-up: agent prompt

A prompt for an agent that keeps AnyList recipe ingredients tidy on a schedule. Run it weekly.

The agent needs this MCP server connected, the same way Claude or Claude Code connects (see [cloudflare-workers.md](cloudflare-workers.md)). It signs in through the server, so no AnyList password is stored with the agent. For an agent that can only run shell commands, see [Without MCP](#without-mcp) at the end.

## Why this matters

AnyList shows each ingredient line as **quantity**, then **name** in bold, then **note** in italics underneath, and "Add to list" puts the **name** on the shopping list. The line's stored text isn't shown anywhere once those fields exist. Recipe imports often parse badly, leaving units and prep inside the name ("Tbsp Butter", "cup/225 grams unsalted butter (2 sticks), softened"), so the shopping list gets junk items.

## Prompt

Copy everything below into the agent.

---

You keep the ingredient lines in my AnyList recipes tidy, using the `anylist` MCP server's `recipes` tool.

**1. Find recently added recipes.** Call `recipes` with `action: "list_ingredients"` and `since` set to 8 days ago (`YYYY-MM-DD`). Each row is tab-separated: recipe id, kind (`ingredient` or `heading`), name, quantity, note, and the line's stored text. If it reports no recipes, stop and say so.

To see a recipe's title for your report, call `recipes` with `action: "get"` and its `recipe_id`.

**2. Decide the fixes, line by line.** Leave a line alone when it's already clean. Before choosing a name, check what my other recipes call that ingredient: call `list_ingredients` with `search` set to its main word (for example "onion") and reuse the most common name with its exact spelling, so the shopping list stays consistent ("green onions" becomes `scallions` if that's what I use elsewhere).

For each line that needs work, set:

- **name**: the product I'd buy, lowercase except proper nouns and brands that are part of the product (Parmesan, Dijon mustard, Yukon Gold potatoes). No quantities, units, sizes, prep or serving notes.
  - Keep words that change what you buy: dried, frozen, canned, ground, smoked, unsalted, low-sodium, extra-virgin, toasted, boneless skinless. Keep "fresh" only where a dried or ground form is common (fresh basil, fresh ginger, fresh thyme).
  - For "X or Y", the name is X, and "or Y" goes in the note.
  - Match the count. With a plain count of 1 or less (`1`, `1 large`, `½`), use the singular: `egg`. With a plain count above 1, use the plural if the line was written in the plural: `2 medium` + `white onions`. Measured amounts (`2 tablespoons`) don't change the name's form. Watch irregular plurals: leaves → leaf, halves → half, loaves → loaf.
  - Citrus: "juice of 1 lemon" with no quantity becomes quantity `1`, name `lemon`, note `juice`. A measured amount becomes `lemon juice` or `lemon zest` ("1 teaspoon" + "lemon zest").
- **quantity**: the existing quantity, plus any amount that ended up at the start of the name: a unit with its metric equivalent (`1` + "cup/225 grams …" becomes `1 cup/225 grams`), or `pinch`, `handful`, `few dashes`. Never add a bare count to a line that already has a measured quantity. Keep AnyList's unit spellings as written (Tbsp, tsp, oz); don't expand them.
- **note**: the details that left the name, as a short natural phrase in their original wording: prep ("finely chopped", "at room temperature", "divided"), qualifiers the name dropped ("kosher", "packed", "light or dark"), alternatives ("or cashew cream"), and useful parentheticals ("2 sticks", "optional"). Keep any existing note, joined with "; ". Drop prices, "see note" and HTML. Lowercase except proper nouns.
- **Headings**: a line that's really a section label ("For the sauce:", "Filling") becomes a heading: `is_heading: true`, `name` set to the label, and `quantity` and `note` set to "".

Skip a line, and list it in your report instead, if it isn't clearly one ingredient (two ingredients on one line, an instruction, a sub-recipe reference you're unsure about) or if you're unsure of the product. Never change a line's stored text: it's how a change finds its line, now and if it ever needs undoing.

**3. Apply.** Call `recipes` with `action: "update_ingredients"` and `ingredient_changes`, one entry per line:

```json
[
  { "recipe_id": "<id>", "match": "<the line's stored text, exactly as listed>", "name": "unsalted butter", "quantity": "1 cup/225 grams", "note": "2 sticks, softened" },
  { "recipe_id": "<id>", "match": "For the sauce:", "is_heading": true, "name": "For the sauce:", "quantity": "", "note": "" }
]
```

Include only the fields you change. If more than 300 lines need changes, stop before applying and report, because something unusual happened (a big import, or a bad result from step 1).

**4. Report** in a few lines:
- how many recipes you checked and lines you changed
- a table of the changed lines: recipe title, stored text, before (quantity | name | note), after
- the lines you skipped, and why
- any "Not changed" lines that `update_ingredients` returned

The before values are the undo: calling `update_ingredients` with the same `recipe_id` and `match` and the before values puts a line back.

---

## Without MCP

An agent that can only run shell commands can use [`scripts/tidy-ingredients.mjs`](../scripts/tidy-ingredients.mjs) instead. It signs in to AnyList directly, so it needs `ANYLIST_USERNAME`, `ANYLIST_PASSWORD` and `ANYLIST_LIST_NAME` set, and a checkout of this repo with `npm install` done. It also keeps backups and tracks the last run.

Use the prompt above with these replacements:

- **Step 1:** run `node scripts/tidy-ingredients.mjs export --out /tmp/tidy-export.json`. The file has `exportedAt`, the `recipes` added since the last run (each with its title and `lines`: `text`, `name`, `quantity`, `note`, `isHeading`), and `vocabulary`: the names already used across all recipes, most used first. Pick names from `vocabulary` instead of searching. With no recipes, go straight to step 3 with an empty change list.
- **Step 3:** write `/tmp/tidy-changes.json` as `{ "exportedAt": "<from the export>", "changes": [ … ] }`, with the same change entries as above, then run:
  ```bash
  node scripts/tidy-ingredients.mjs apply /tmp/tidy-changes.json --dry-run
  node scripts/tidy-ingredients.mjs apply /tmp/tidy-changes.json
  ```
  Always run the real `apply`, even with no changes, because it records the run so the next export starts from here.
- **Step 4:** also report the backup path that `apply` printed. `node scripts/tidy-ingredients.mjs restore <backup path>` undoes the run.

The script keeps its run state and backups in `~/.anylist-tidy/`.
