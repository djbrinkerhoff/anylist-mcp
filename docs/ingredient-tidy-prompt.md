# Ingredient tidy-up: agent prompt

A prompt for an agent that keeps AnyList recipe ingredients tidy on a schedule (weekly works well). It pairs with [`scripts/tidy-ingredients.mjs`](../scripts/tidy-ingredients.mjs), which does the reading, backing up and saving; the agent only decides the fixes.

The agent needs a shell in this repo (with `npm install` done) and these environment variables: `ANYLIST_USERNAME`, `ANYLIST_PASSWORD`, `ANYLIST_LIST_NAME`.

## Why this matters

AnyList shows each ingredient line as **quantity**, then **name** in bold, then **note** in italics underneath, and "Add to list" puts the **name** on the shopping list. The line's stored text isn't shown anywhere once those fields exist. Recipe imports often parse badly, leaving units and prep inside the name ("Tbsp Butter", "cup/225 grams unsalted butter (2 sticks), softened"), so the shopping list gets junk items.

## Prompt

Copy everything below into the agent.

---

You keep the ingredient lines in my AnyList recipes tidy. Work in the `anylist-mcp` repo.

**1. Export recently added recipes.**

```bash
node scripts/tidy-ingredients.mjs export --out /tmp/tidy-export.json
```

The file has `exportedAt`, the `recipes` added since the last run (each with its `lines`: `text`, `name`, `quantity`, `note`, `isHeading`), and `vocabulary`: names already used across all my recipes, with how often. If there are no recipes, skip to step 3 with an empty change list.

**2. Decide the fixes, line by line.** Leave a line alone when it's already clean. For each line that needs work, set:

- **name**: the product I'd buy, lowercase except proper nouns and brands that are part of the product (Parmesan, Dijon mustard, Yukon Gold potatoes). No quantities, units, sizes, prep or serving notes.
  - **Reuse a vocabulary name** whenever one fits, with its exact spelling, so the shopping list stays consistent ("green onions" → `scallions` if that's the vocabulary name).
  - Keep words that change what you buy: dried, frozen, canned, ground, smoked, unsalted, low-sodium, extra-virgin, toasted, boneless skinless. Keep "fresh" only where a dried or ground form is common (fresh basil, fresh ginger, fresh thyme).
  - For "X or Y", the name is X, and "or Y" goes in the note.
  - Match the count: with a plain count of 1 or less (`1`, `1 large`, `½`), use the singular (`egg`); with a plain count above 1, use the plural if the original was plural (`2 medium` + `white onions`). Measured amounts (`2 tablespoons`) don't change the name's form.
  - Citrus: "juice of 1 lemon" with no quantity becomes quantity `1`, name `lemon`, note `juice`. A measured amount becomes `lemon juice` or `lemon zest` ("1 teaspoon" + "lemon zest").
- **quantity**: the existing quantity, plus any amount that ended up at the start of the name: a unit with its metric equivalent (`1` + "cup/225 grams …" → `1 cup/225 grams`), or `pinch`, `handful`, `few dashes`. Never add a bare count to a line that already has a measured quantity. Keep AnyList's unit spellings as written (Tbsp, tsp, oz); don't expand them.
- **note**: the details that left the name, as a short natural phrase in their original wording: prep ("finely chopped", "at room temperature", "divided"), qualifiers that the name dropped ("kosher", "packed", "light or dark"), alternatives ("or cashew cream"), useful parentheticals ("2 sticks", "optional"). Keep any existing note, joined with "; ". Drop prices, "see note" and HTML. Lowercase except proper nouns.
- **Headings**: a line that's really a section label ("For the sauce:", "Filling") becomes a heading: `is_heading: true`, `name` set to the label, and `quantity` and `note` set to "".

**Skip a line**, and list it in your report instead, if it isn't clearly one ingredient (two ingredients on one line, an instruction, a sub-recipe reference you're unsure about) or if you're unsure of the product. Never change the stored `text`.

**3. Write the changes and apply them.** Write `/tmp/tidy-changes.json` as:

```json
{
  "exportedAt": "<exportedAt from the export>",
  "changes": [
    { "recipe_id": "<id>", "match": "<the line's text, exactly as exported>", "name": "…", "quantity": "…", "note": "…" },
    { "recipe_id": "<id>", "match": "For the sauce:", "is_heading": true, "name": "For the sauce:", "quantity": "", "note": "" }
  ]
}
```

Include only the fields you change. Check it first, then apply:

```bash
node scripts/tidy-ingredients.mjs apply /tmp/tidy-changes.json --dry-run
node scripts/tidy-ingredients.mjs apply /tmp/tidy-changes.json
```

Always run the real `apply`, even with no changes, because it records this run so the next export starts from here. If more than 300 lines need changes, stop before applying and report, because something unusual happened (a big import or a bad export).

**4. Report** in a few lines:
- how many recipes you checked and lines you changed
- a table of the changed lines: recipe, before (quantity | name | note), after
- the lines you skipped, and why
- any "Not changed" lines that `apply` printed
- the backup path that `apply` printed, and that `node scripts/tidy-ingredients.mjs restore <backup path>` undoes the run

---

## Running it yourself

```bash
node --env-file=.env scripts/tidy-ingredients.mjs export --since 2026-10-01 --out /tmp/tidy-export.json
node --env-file=.env scripts/tidy-ingredients.mjs apply /tmp/tidy-changes.json --dry-run
node --env-file=.env scripts/tidy-ingredients.mjs restore ~/.anylist-tidy/backup-<time>.json
```

The run state (`lastRun`) and the backups are kept in `~/.anylist-tidy/`.
