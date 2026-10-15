import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../../src/tools/recipe-collections.js';
import { MockAnyListClient, createMockServer } from './helpers.js';

describe('recipe_collections tool', () => {
  let client;
  let handlers;

  beforeEach(() => {
    client = new MockAnyListClient();
    const { server, handlers: h } = createMockServer();
    register(server, () => Promise.resolve(client));
    handlers = h;
  });

  describe('list', () => {
    it('returns empty message when no collections', async () => {
      const result = await handlers.recipe_collections({ action: 'list' });
      assert.ok(result.content[0].text.includes('No recipe collections'));
    });

    it('lists collections with recipe names', async () => {
      client._collections.push({ identifier: 'c-9', name: 'Weeknight', recipeCount: 2, recipeNames: ['Pasta', 'Salad'] });
      const result = await handlers.recipe_collections({ action: 'list' });
      assert.ok(result.content[0].text.includes('Weeknight'));
      assert.ok(result.content[0].text.includes('id: c-9'));
      assert.ok(result.content[0].text.includes('Pasta'));
    });
  });

  describe('create', () => {
    it('creates a collection', async () => {
      const result = await handlers.recipe_collections({ action: 'create', name: 'Quick Meals' });
      assert.ok(result.content[0].text.includes('Created recipe collection "Quick Meals"'));
    });

    it('creates collection with recipes', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta' });
      const result = await handlers.recipe_collections({ action: 'create', name: 'Favs', recipe_names: ['Pasta'] });
      assert.ok(result.content[0].text.includes('with 1 recipes'));
      assert.equal(client._collections[client._collections.length - 1].recipeNames[0], 'Pasta');
    });

    it('reports recipe names it could not match', async () => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta' }, { identifier: 'r-2', name: 'Soup' }, { identifier: 'r-3', name: 'Soup' });
      const result = await handlers.recipe_collections({ action: 'create', name: 'Favs', recipe_names: ['Pasta', 'Moules Marières', 'Soup'] });
      const text = result.content[0].text;
      assert.ok(text.includes('with 1 recipes'));
      assert.ok(text.includes('no recipe with this name: Moules Marières'));
      assert.ok(text.includes('several recipes share this name: Soup'));
    });
  });

  describe('add_recipes', () => {
    beforeEach(() => {
      client._recipes.push({ identifier: 'r-1', name: 'Pasta' }, { identifier: 'r-2', name: 'Salad' });
      client._collections.push({ identifier: 'c-1', name: 'Weeknight', recipeCount: 1, recipeNames: ['Pasta'] });
    });

    it('adds new recipes and counts ones already in it', async () => {
      const result = await handlers.recipe_collections({ action: 'add_recipes', name: 'Weeknight', recipe_names: ['Pasta', 'Salad', 'Nope'] });
      const text = result.content[0].text;
      assert.ok(text.includes('Added 1 recipes to "Weeknight" (1 already in it)'));
      assert.ok(text.includes('no recipe with this name: Nope'));
      assert.deepEqual(client._collections[0].recipeNames, ['Pasta', 'Salad']);
    });

    it('requires recipe_names', async () => {
      const result = await handlers.recipe_collections({ action: 'add_recipes', name: 'Weeknight' });
      assert.equal(result.isError, true);
    });
  });

  describe('remove_recipes', () => {
    it('removes recipes and reports ones not in the collection', async () => {
      client._collections.push({ identifier: 'c-1', name: 'Weeknight', recipeCount: 2, recipeNames: ['Pasta', 'Salad'] });
      const result = await handlers.recipe_collections({ action: 'remove_recipes', name: 'Weeknight', recipe_names: ['Salad', 'Soup'] });
      const text = result.content[0].text;
      assert.ok(text.includes('Removed 1 recipes from "Weeknight"'));
      assert.ok(text.includes('Not in collection: Soup'));
      assert.deepEqual(client._collections[0].recipeNames, ['Pasta']);
    });
  });

  describe('delete', () => {
    it('deletes an existing collection', async () => {
      client._collections.push({ name: 'Old Collection', recipeCount: 0, recipeNames: [] });
      const result = await handlers.recipe_collections({ action: 'delete', name: 'Old Collection' });
      assert.ok(result.content[0].text.includes('Deleted recipe collection'));
      assert.equal(client._collections.length, 0);
    });

    it('returns error for non-existent collection', async () => {
      const result = await handlers.recipe_collections({ action: 'delete', name: 'Nope' });
      assert.equal(result.isError, true);
      assert.ok(result.content[0].text.includes('not found'));
    });

    it('refuses an ambiguous name and deletes by collection_id', async () => {
      client._collections.push(
        { identifier: 'c-1', name: 'Week Two', recipeCount: 0, recipeNames: [] },
        { identifier: 'c-2', name: 'Week Two', recipeCount: 0, recipeNames: [] },
      );
      const ambiguous = await handlers.recipe_collections({ action: 'delete', name: 'Week Two' });
      assert.equal(ambiguous.isError, true);
      assert.ok(ambiguous.content[0].text.includes('c-1, c-2'));
      await handlers.recipe_collections({ action: 'delete', collection_id: 'c-1' });
      assert.deepEqual(client._collections.map(c => c.identifier), ['c-2']);
    });
  });
});
