# Tool Reference

Functionality is organized into **5 domain-grouped tools**. Every domain tool takes an `action` enum plus action-specific parameters.

```json
{ "name": "shopping", "arguments": { "action": "add_item", "name": "Milk", "quantity": 2 } }
```

---

## `health_check`

Tests the connection to AnyList and verifies access to the target list.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `list_name` | string | No | List to test (defaults to configured default) |

---

## `shopping`

Manage shopping lists and items.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | See actions below |
| `list_name` | string | No | Target list (defaults to configured default) |
| `name` | string | For item actions | Item name (add_item, check_item, uncheck_item, delete_item) |
| `items` | array | For add_items | Items to add; each is a plain name or `{ name, quantity, notes, category, store_name }` |
| `quantity` | number \| string | No | e.g. `2` or `"500 g"` (add_item only, default 1) |
| `notes` | string | No | Item notes (add_item only) |
| `category` | enum | No | Category for item (add_item only, default `other`) — see below |
| `store_name` | string | No | Store to assign to the item (add_item only); must be one of the list's stores |
| `include_checked` | boolean | No | Include checked-off items (list_items only) |
| `include_notes` | boolean | No | Include item notes in output (list_items only) |

**Categories:** `baby`, `bakery`, `beverages`, `breakfast-and-cereal`, `condiments-oils-and-salad-dressings`, `cooking-and-baking`, `dairy`, `frozen-foods`, `grains-pasta-and-side-dishes`, `health-and-personal-care`, `household-and-cleaning`, `meat`, `pet-supplies`, `produce`, `seafood`, `snacks-cookies-and-candy`, `soups-and-canned-goods`, `wine-beer-spirits`, `other`

**Actions:**

```json
// List all shopping lists with item counts
{ "name": "shopping", "arguments": { "action": "list_lists" } }

// List items on a list, grouped by category
{ "name": "shopping", "arguments": { "action": "list_items", "list_name": "Costco", "include_notes": true } }

// Add an item
{ "name": "shopping", "arguments": { "action": "add_item", "name": "Eggs", "quantity": 2, "notes": "organic", "category": "dairy", "store_name": "Costco" } }

// Add several items in one call
{ "name": "shopping", "arguments": { "action": "add_items", "items": [
    "Bananas",
    { "name": "Flour", "quantity": "2 kg", "category": "cooking-and-baking" }
] } }

// Check off an item (supports partial name matching)
{ "name": "shopping", "arguments": { "action": "check_item", "name": "Eggs" } }

// Uncheck a checked-off item (supports partial matching against checked items)
{ "name": "shopping", "arguments": { "action": "uncheck_item", "name": "Eggs" } }

// Delete an item permanently
{ "name": "shopping", "arguments": { "action": "delete_item", "name": "Eggs" } }

// Get favorite items for a list
{ "name": "shopping", "arguments": { "action": "get_favorites" } }

// Get recently added items for a list
{ "name": "shopping", "arguments": { "action": "get_recents" } }

// List the stores configured for a list
{ "name": "shopping", "arguments": { "action": "list_stores" } }
```

---

## `recipes`

Manage AnyList recipes, including URL import and text parsing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | See actions below |
| `name` | string | For most actions | Recipe name |
| `recipe_id` | string | No | Recipe ID from `list` (get, update, delete) — use when several recipes share a name |
| `new_name` | string | No | Rename the recipe (update only) |
| `search` | string | No | Filter recipes by name (list), or ingredients by name or text (list_ingredients) |
| `ingredients` | array | No | `[{ name, quantity }]` (create, update — replaces list on update) |
| `steps` | string[] | No | Preparation steps (create, update — replaces list on update) |
| `note` | string | No | Recipe notes (create, update) |
| `source_name` | string | No | Source attribution (create, update) |
| `source_url` | string | No | Source URL (create, update) |
| `prep_time` | number | No | Prep time in minutes (create, update) |
| `cook_time` | number | No | Cook time in minutes (create, update) |
| `servings` | string | No | e.g. `"4"` or `"4-6"` (create, update) |
| `url` | string | For import/normalize | URL to fetch recipe from |
| `text` | string | For normalize | Raw recipe text to parse |
| `save` | boolean | No | Save normalized result to AnyList (normalize only) |
| `ingredient_changes` | array | For update_ingredients | Up to 500 `{ recipe_id, match, text?, name?, quantity?, note?, is_heading? }` |

**Actions:**

```json
// Browse all recipes (summaries: name, rating, times, servings)
{ "name": "recipes", "arguments": { "action": "list" } }

// Search recipes
{ "name": "recipes", "arguments": { "action": "list", "search": "chicken" } }

// Get full details — ingredients and steps
{ "name": "recipes", "arguments": { "action": "get", "name": "Chicken Tikka Masala" } }

// Create a recipe
{ "name": "recipes", "arguments": {
    "action": "create",
    "name": "Simple Pasta",
    "ingredients": [
      { "name": "spaghetti", "quantity": "1 lb" },
      { "name": "garlic cloves", "quantity": "2" },
      { "name": "olive oil", "quantity": "1/4 cup" }
    ],
    "steps": ["Boil pasta", "Sauté garlic in oil", "Toss together"],
    "servings": "4"
} }

// Partially update a recipe — only the fields you pass change; the rest
// (identifier, note, photos, collection membership, meal-plan links) are kept.
// ingredients and steps, when provided, replace the whole array.
{ "name": "recipes", "arguments": { "action": "update", "name": "Simple Pasta", "servings": "6", "note": "Doubled the garlic" } }

// Rename a recipe in place (fails if another recipe already has the new name)
{ "name": "recipes", "arguments": { "action": "update", "name": "Simple Pasta", "new_name": "Garlic Pasta" } }

// Delete a recipe
{ "name": "recipes", "arguments": { "action": "delete", "name": "Simple Pasta" } }

// Every ingredient line across all recipes, as tab-separated rows
// (recipe id, kind, name, quantity, note, stored text). search filters by name or text.
{ "name": "recipes", "arguments": { "action": "list_ingredients", "search": "garlic" } }

// Edit ingredient lines in place. Each change finds a line by its current stored text
// ("match") in one recipe and sets only the fields given; the line keeps its position.
// AnyList displays lines from quantity, name and note, and adds the name to shopping lists.
{ "name": "recipes", "arguments": { "action": "update_ingredients", "ingredient_changes": [
    { "recipe_id": "<id>", "match": "1 cup/225 grams unsalted butter (2 sticks), softened",
      "name": "unsalted butter", "quantity": "1 cup/225 grams", "note": "2 sticks, softened" },
    { "recipe_id": "<id>", "match": "For the Filling", "is_heading": true, "name": "For the Filling" }
] } }

// Import a recipe from a website URL
{ "name": "recipes", "arguments": { "action": "import_url", "url": "https://..." } }

// Parse and preview a recipe without saving (set save=true to also save)
{ "name": "recipes", "arguments": { "action": "normalize", "url": "https://..." } }
{ "name": "recipes", "arguments": { "action": "normalize", "text": "Pasta\n\n1 lb spaghetti\n\n1. Boil pasta", "save": true } }
```

---

## `meal_plan`

Manage the AnyList meal planning calendar.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | See actions below |
| `date` | string | For create | Date in `YYYY-MM-DD` format (create_event, update_event) |
| `title` | string | No | Event title (use this or `recipe_id`) |
| `recipe_id` | string | No | Link an existing recipe by ID |
| `label_id` | string | No | Meal type label ID (get from `list_labels`) |
| `details` | string | No | Additional notes |
| `event_id` | string | For update, delete | Event ID (shown by `list_events`) |
| `start_date` | string | No | Only events on or after this date, `YYYY-MM-DD` (list_events only) |
| `end_date` | string | No | Only events on or before this date, `YYYY-MM-DD` (list_events only) |

**Actions:**

```json
// View all meal plan events, sorted by date. Each line shows the event id,
// plus the linked recipe's id when there is one.
{ "name": "meal_plan", "arguments": { "action": "list_events" } }

// View events in a date range
{ "name": "meal_plan", "arguments": { "action": "list_events", "start_date": "2025-02-10", "end_date": "2025-02-16" } }

// Get available labels (Breakfast, Lunch, Dinner, etc.) with their IDs
{ "name": "meal_plan", "arguments": { "action": "list_labels" } }

// Schedule a meal
{ "name": "meal_plan", "arguments": {
    "action": "create_event",
    "date": "2025-02-15",
    "title": "Pizza Night",
    "label_id": "<id from list_labels>"
} }

// Change an event — only the fields you pass change. AnyList can't change an
// event's date or recipe in place, so this replaces the event and returns its new id.
{ "name": "meal_plan", "arguments": { "action": "update_event", "event_id": "<id>", "date": "2025-02-16", "recipe_id": "<recipe id>" } }

// Delete an event
{ "name": "meal_plan", "arguments": { "action": "delete_event", "event_id": "<id>" } }
```

---

## `recipe_collections`

Organize recipes into named collections.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | Yes | `list`, `create`, `delete`, `add_recipes`, or `remove_recipes` |
| `name` | string | For create | Collection name (delete, add_recipes, remove_recipes take `name` or `collection_id`) |
| `collection_id` | string | No | Collection ID from `list` — use when several collections share a name |
| `recipe_names` | string[] | For add/remove | Recipes to include (create, add_recipes) or take out (remove_recipes) |

Recipe names that match no recipe, or more than one recipe, are skipped and listed in the response.

**Actions:**

```json
// List all collections with their ids
{ "name": "recipe_collections", "arguments": { "action": "list" } }

// Create a collection
{ "name": "recipe_collections", "arguments": {
    "action": "create",
    "name": "Weeknight Dinners",
    "recipe_names": ["Simple Pasta", "Chicken Tikka Masala"]
} }

// Add recipes to an existing collection (ones already in it are left alone)
{ "name": "recipe_collections", "arguments": { "action": "add_recipes", "name": "Weeknight Dinners", "recipe_names": ["Kimchi Fried Rice"] } }

// Remove recipes from a collection (the recipes themselves are kept)
{ "name": "recipe_collections", "arguments": { "action": "remove_recipes", "name": "Weeknight Dinners", "recipe_names": ["Simple Pasta"] } }

// Delete a collection (the recipes themselves are kept)
{ "name": "recipe_collections", "arguments": { "action": "delete", "name": "Weeknight Dinners" } }
```

---

## Typical multi-step interaction

1. **Browse recipes** — `recipes` → `list`
2. **Get details** — `recipes` → `get` with `name`
3. **Plan the meal** — `meal_plan` → `create_event` with date and title
4. **Add ingredients** — `shopping` → `add_item` for each ingredient
