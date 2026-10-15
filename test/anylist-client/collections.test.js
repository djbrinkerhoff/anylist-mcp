/**
 * Tests for recipe collection operations: getRecipeCollections, createRecipeCollection,
 * addRecipesToCollection, removeRecipesFromCollection, deleteRecipeCollection.
 *
 * Writes go through a fresh client where it matters: AnyList silently ignores
 * collection operations sent before recipes are loaded (no recipeDataId), and
 * a client that already loaded recipes would hide that.
 */
import { createConnectedClient, makeRunner, printSuiteResults } from './helpers.js';

const COLLECTION = `🧪 Test Collection ${Date.now()}`;

function uniqueRecipeNames(recipes) {
  const counts = new Map();
  for (const r of recipes) counts.set(r.name, (counts.get(r.name) || 0) + 1);
  return recipes.map(r => r.name).filter(n => counts.get(n) === 1);
}

export async function runCollectionsTests() {
  console.log('\n📚 Recipe Collections');
  const { test, results } = makeRunner();

  const client = await createConnectedClient();

  await test('getRecipeCollections returns array', async () => {
    const collections = await client.getRecipeCollections();
    if (!Array.isArray(collections)) throw new Error('getRecipeCollections() should return an array');
    if (collections.length > 0) {
      const c = collections[0];
      if (typeof c.identifier !== 'string') throw new Error('Collection should have identifier string');
      if (typeof c.name !== 'string') throw new Error('Collection should have name string');
      if (typeof c.recipeCount !== 'number') throw new Error('Collection should have recipeCount number');
      if (!Array.isArray(c.recipeNames)) throw new Error('Collection should have recipeNames array');
    }
  });

  await test('createRecipeCollection creates empty collection', async () => {
    const fresh = await createConnectedClient();
    const result = await fresh.createRecipeCollection(COLLECTION, []);
    await fresh.disconnect();
    if (!result.identifier) throw new Error('createRecipeCollection should return identifier');
    if (result.name !== COLLECTION) throw new Error(`Expected name "${COLLECTION}", got "${result.name}"`);
  });

  await test('created collection appears in getRecipeCollections', async () => {
    const collections = await client.getRecipeCollections();
    const found = collections.find(c => c.name === COLLECTION);
    if (!found) throw new Error(`Collection "${COLLECTION}" not found after creation`);
    if (found.recipeCount !== 0) throw new Error(`Expected 0 recipes, got ${found.recipeCount}`);
  });

  // Test with recipes if any exist
  await test('createRecipeCollection with existing recipe names resolves them', async () => {
    const recipes = await client.getRecipes();
    if (recipes.length === 0) {
      console.log('    (skipped — no recipes in account to add to collection)');
      return;
    }
    const firstName = uniqueRecipeNames(recipes)[0];
    const COLLECTION_WITH_RECIPE = `🧪 Test Collection Recipes ${Date.now()}`;
    const result = await client.createRecipeCollection(COLLECTION_WITH_RECIPE, [firstName, '🚫 No Such Recipe']);
    if (!result.identifier) throw new Error('Should return identifier');
    if (!result.missing.includes('🚫 No Such Recipe')) throw new Error('Unknown recipe name should be reported in missing');

    const collections = await client.getRecipeCollections();
    const found = collections.find(c => c.name === COLLECTION_WITH_RECIPE);
    if (!found) throw new Error('Collection with recipe not found after creation');
    if (found.recipeCount !== 1) throw new Error(`Expected 1 recipe, got ${found.recipeCount}`);
    if (!found.recipeNames.includes(firstName)) throw new Error(`Expected recipe "${firstName}" in collection`);
    await client.deleteRecipeCollection(COLLECTION_WITH_RECIPE);
  });

  await test('addRecipesToCollection and removeRecipesFromCollection change only the given recipes', async () => {
    const names = uniqueRecipeNames(await client.getRecipes()).slice(0, 3);
    if (names.length < 3) {
      console.log('    (skipped — need 3 uniquely named recipes)');
      return;
    }
    const fresh = await createConnectedClient();
    const added = await fresh.addRecipesToCollection(COLLECTION, names);
    await fresh.disconnect();
    if (added.added !== 3) throw new Error(`Expected 3 added, got ${added.added}`);
    let found = (await client.getRecipeCollections()).find(c => c.name === COLLECTION);
    if (found.recipeCount !== 3) throw new Error(`Expected 3 recipes after add, got ${found.recipeCount}`);

    const removed = await client.removeRecipesFromCollection(COLLECTION, [names[1]]);
    if (removed.removed !== 1) throw new Error(`Expected 1 removed, got ${removed.removed}`);
    found = (await client.getRecipeCollections()).find(c => c.name === COLLECTION);
    const expected = [names[0], names[2]].sort().join(' | ');
    if ([...found.recipeNames].sort().join(' | ') !== expected) {
      throw new Error(`Expected ${expected} after remove, got ${found.recipeNames.join(' | ')}`);
    }
  });

  await test('deleteRecipeCollection removes the collection', async () => {
    const fresh = await createConnectedClient();
    await fresh.deleteRecipeCollection(COLLECTION);
    await fresh.disconnect();
    const collections = await client.getRecipeCollections();
    if (collections.some(c => c.name === COLLECTION)) throw new Error(`Collection "${COLLECTION}" still exists after delete`);
  });

  await client.disconnect();
  return printSuiteResults('Recipe Collections', results());
}
