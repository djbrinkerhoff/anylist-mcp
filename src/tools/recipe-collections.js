import { z } from "zod";
import { textResponse, errorResponse } from "./helpers.js";
import { createElicitationHelpers } from "./elicitation.js";

function skippedNotes({ missing, ambiguous }) {
  let text = "";
  if (missing.length > 0) text += `\nSkipped, no recipe with this name: ${missing.join(', ')}`;
  if (ambiguous.length > 0) text += `\nSkipped, several recipes share this name: ${ambiguous.join(', ')}`;
  return text;
}

export function register(server, getClient) {
  const { elicitRequiredField } = createElicitationHelpers(server);

  server.registerTool("recipe_collections", {
    title: "Recipe Collections",
    description: `Manage AnyList recipe collections. Actions:
- list: Show all collections with ids, recipe counts and names
- create: Create a new collection, optionally with recipes
- delete: Delete a collection (its recipes are kept)
- add_recipes: Add recipes to an existing collection
- remove_recipes: Remove recipes from a collection (the recipes themselves are kept)
Recipe names that match no recipe, or several recipes, are skipped and reported.
When several collections share a name, pass collection_id.`,
    inputSchema: {
      action: z.enum(["list", "create", "delete", "add_recipes", "remove_recipes"]).describe("The collection action to perform"),
      name: z.string().optional().describe("Collection name (required for create; delete, add_recipes, remove_recipes need name or collection_id)"),
      collection_id: z.string().optional().describe("Collection id from list (delete, add_recipes, remove_recipes); takes precedence over name"),
      recipe_names: z.array(z.string()).optional().describe("Recipe names (create, add_recipes, remove_recipes)"),
    }
  }, async (params) => {
    const { action, name, collection_id, recipe_names } = params;
    try {
      const client = await getClient();
      await client.connect(null);
      switch (action) {
        case "list": {
          const collections = await client.getRecipeCollections();
          if (collections.length === 0) return textResponse("No recipe collections found.");
          const list = collections.map(c => `- **${c.name}** (id: ${c.identifier}) (${c.recipeCount} recipes)${c.recipeCount > 0 ? ': ' + c.recipeNames.join(', ') : ''}`).join('\n');
          return textResponse(`Recipe Collections (${collections.length}):\n${list}`);
        }
        case "create": {
          let collectionName = name;
          if (!collectionName) collectionName = await elicitRequiredField("name", "What should the collection be called?");
          const result = await client.createRecipeCollection(collectionName, recipe_names || []);
          return textResponse(`Created recipe collection "${result.name}" with ${result.recipeCount} recipes` + skippedNotes(result));
        }
        case "delete": {
          let deleteCollectionName = name;
          if (!deleteCollectionName && !collection_id) deleteCollectionName = await elicitRequiredField("name", "Which collection would you like to delete?");
          const result = await client.deleteRecipeCollection(deleteCollectionName, collection_id);
          return textResponse(`Deleted recipe collection "${result.name}"`);
        }
        case "add_recipes":
        case "remove_recipes": {
          if (!name && !collection_id) throw new Error(`Action "${action}" requires "name" or "collection_id"`);
          if (!recipe_names || recipe_names.length === 0) throw new Error(`Action "${action}" requires "recipe_names"`);
          if (action === "add_recipes") {
            const result = await client.addRecipesToCollection(name, recipe_names, collection_id);
            let text = `Added ${result.added} recipes to "${result.name}"`;
            if (result.alreadyIn > 0) text += ` (${result.alreadyIn} already in it)`;
            return textResponse(text + skippedNotes(result));
          }
          const result = await client.removeRecipesFromCollection(name, recipe_names, collection_id);
          let text = `Removed ${result.removed} recipes from "${result.name}"`;
          if (result.notInCollection.length > 0) text += `\nNot in collection: ${result.notInCollection.join(', ')}`;
          if (result.ambiguous.length > 0) text += `\nSkipped, several recipes in the collection share the name: ${result.ambiguous.join(', ')}`;
          return textResponse(text);
        }
      }
    } catch (error) {
      return errorResponse(`Recipe collections ${action} failed: ${error.message}`);
    }
  });
}
