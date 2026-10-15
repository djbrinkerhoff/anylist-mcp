/**
 * Shared test infrastructure for tool-level tests.
 *
 * createMockServer() — returns a minimal MCP server stub that captures
 *   registerTool() calls, plus the resulting handlers map.
 *
 * MockAnyListClient — in-memory client that owns its own state arrays.
 *   Call client.reset() (or create a fresh instance) in beforeEach.
 */

export function createMockServer() {
  const handlers = {};
  const server = {
    registerTool: (name, _schema, handler) => {
      handlers[name] = handler;
      // Return a stub registeredTool so callers can call .update() without error.
      return { update: () => {} };
    },
    // elicitation.js calls server.server.getClientCapabilities() to detect support.
    // Returning null means elicitation is disabled; missing-param paths throw instead.
    server: { getClientCapabilities: () => null },
  };
  return { server, handlers };
}

export class MockAnyListClient {
  constructor() {
    this.client = null;
    this.targetList = null;
    this._connected = false;
    this.defaultListName = null;
    this._items = [];
    this._lists = [];
    this._favorites = [];
    this._recents = [];
    this._recipes = [];
    this._events = [];
    this._labels = [];
    this._collections = [];
    this._pendingImport = null;
    this._stores = [];
  }

  reset() {
    this.client = null;
    this.targetList = null;
    this._connected = false;
    this._items = [];
    this._lists = [];
    this._favorites = [];
    this._recents = [];
    this._recipes = [];
    this._events = [];
    this._labels = [];
    this._collections = [];
    this._pendingImport = null;
    this._stores = [];
  }

  async connect(listName = null) {
    const name = listName || process.env.ANYLIST_LIST_NAME || 'Test List';
    this._connected = true;
    const items = this._items;
    this.targetList = {
      name,
      identifier: 'list-123',
      items,
      getItemByName: (n) => items.find(i => i.name.toLowerCase() === n.toLowerCase()) || null,
    };
    this.client = {};
    return true;
  }

  getLists() { return this._lists; }
  getStores() { return this._stores || []; }

  async addItem(name, qty, notes, category, store = null) {
    this._items.push({ name, quantity: qty, notes, category, store });
  }

  async removeItem(name) {
    const idx = this._items.findIndex(i => i.name === name);
    if (idx === -1) throw new Error(`Item "${name}" not found in list, so can't check it`);
    this._items[idx].checked = true;
  }

  async uncheckItem(name) {
    const idx = this._items.findIndex(i => i.name === name);
    if (idx === -1) throw new Error(`Item "${name}" not found in list, so can't uncheck it`);
    this._items[idx].checked = false;
  }

  async deleteItem(name) {
    const idx = this._items.findIndex(i => i.name === name);
    if (idx === -1) throw new Error(`Item "${name}" not found in list, so can't delete it`);
    this._items.splice(idx, 1);
  }

  async getItems(includeChecked = false, includeNotes = false, includeStore = false) {
    let items = [...this._items];
    if (!includeChecked) items = items.filter(i => !i.checked);
    return items.map(i => ({
      name: i.name,
      quantity: i.quantity || 1,
      checked: i.checked || false,
      category: i.category || 'other',
      ...(includeNotes && i.notes ? { note: i.notes } : {}),
      ...(includeStore && i.store ? { store: i.store } : {}),
    }));
  }

  async setItemStore(name, store) {
    const item = this._items.find(i => i.name === name);
    if (!item) throw new Error(`Item "${name}" not found in list`);
    item.store = store || null;
  }

  async getFavoriteItems() { return this._favorites; }
  async getRecentItems() { return this._recents; }

  async getRecipes(search = null) {
    let r = [...this._recipes];
    if (search) r = r.filter(x => x.name.toLowerCase().includes(search.toLowerCase()));
    return r;
  }

  _findRecipe(name, id = null) {
    if (id) {
      const r = this._recipes.find(x => x.identifier === id);
      if (!r) throw new Error(`Recipe with id "${id}" not found`);
      return r;
    }
    const matches = this._recipes.filter(x => x.name && x.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 0) throw new Error(`Recipe "${name}" not found`);
    if (matches.length > 1) throw new Error(`Multiple recipes named "${name}" (${matches.length}) exist (ids: ${matches.map(x => x.identifier).join(', ')})`);
    return matches[0];
  }

  async getRecipeDetails(name, id = null) {
    const r = this._findRecipe(name, id);
    return { ...r, ingredients: r.ingredients || [], preparationSteps: r.preparationSteps || [] };
  }

  async createRecipe(opts) {
    this._recipes.push(opts);
    return { identifier: 'r-1', name: opts.name };
  }

  async updateRecipe(name, fields = {}, id = null) {
    const r = this._findRecipe(name, id);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) r[key] = value;
    }
    return { identifier: r.identifier, name: r.name };
  }

  async deleteRecipe(name, id = null) {
    this._recipes.splice(this._recipes.indexOf(this._findRecipe(name, id)), 1);
  }

  async importRecipeFromUrl(url) {
    if (!this._pendingImport) throw new Error('Could not parse recipe from URL. The site may not be supported.');
    const imp = this._pendingImport;
    this._recipes.push({ identifier: 'r-imported', name: imp.name, ...imp });
    return {
      name: imp.name,
      identifier: 'r-imported',
      ingredientCount: imp.ingredientCount || 0,
      stepCount: imp.stepCount || 0,
      source: imp.source || null,
      sourceUrl: imp.sourceUrl || url,
    };
  }

  async getMealPlanEvents() { return [...this._events]; }
  async getMealPlanLabels() { return [...this._labels]; }

  async createMealPlanEvent(opts) {
    this._events.push(opts);
    return { identifier: 'e-1', date: opts.date };
  }

  async updateMealPlanEvent(id, fields = {}) {
    const e = this._events.find(x => x.identifier === id);
    if (!e) throw new Error(`Meal plan event "${id}" not found`);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) e[key] = value;
    }
    e.identifier = `${id}-new`;
    return { identifier: e.identifier };
  }

  async deleteMealPlanEvent(id) {
    const idx = this._events.findIndex(e => e.identifier === id);
    if (idx === -1) throw new Error(`Meal plan event "${id}" not found`);
    this._events.splice(idx, 1);
  }

  async getRecipeCollections() { return [...this._collections]; }

  _resolveRecipeNames(names) {
    const found = [];
    const missing = [];
    const ambiguous = [];
    for (const n of names) {
      const matches = this._recipes.filter(r => r.name.toLowerCase() === n.toLowerCase());
      if (matches.length === 0) missing.push(n);
      else if (matches.length > 1) ambiguous.push(n);
      else found.push(matches[0].name);
    }
    return { found, missing, ambiguous };
  }

  _findCollection(name, id = null) {
    if (id) {
      const c = this._collections.find(x => x.identifier === id);
      if (!c) throw new Error(`Recipe collection with id "${id}" not found`);
      return c;
    }
    const matches = this._collections.filter(x => x.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 0) throw new Error(`Recipe collection "${name}" not found`);
    if (matches.length > 1) throw new Error(`Multiple collections named "${name}" (${matches.length}) exist (ids: ${matches.map(x => x.identifier).join(', ')})`);
    return matches[0];
  }

  async createRecipeCollection(name, recipeNames = []) {
    const { found, missing, ambiguous } = this._resolveRecipeNames(recipeNames);
    const c = { identifier: `c-${this._collections.length + 1}`, name, recipeCount: found.length, recipeNames: found };
    this._collections.push(c);
    return { ...c, missing, ambiguous };
  }

  async deleteRecipeCollection(name, id = null) {
    const c = this._findCollection(name, id);
    this._collections.splice(this._collections.indexOf(c), 1);
    return { identifier: c.identifier, name: c.name };
  }

  async addRecipesToCollection(name, recipeNames, id = null) {
    const c = this._findCollection(name, id);
    const { found, missing, ambiguous } = this._resolveRecipeNames(recipeNames);
    const toAdd = found.filter(n => !c.recipeNames.includes(n));
    c.recipeNames.push(...toAdd);
    c.recipeCount = c.recipeNames.length;
    return { name: c.name, added: toAdd.length, alreadyIn: found.length - toAdd.length, missing, ambiguous };
  }

  async removeRecipesFromCollection(name, recipeNames, id = null) {
    const c = this._findCollection(name, id);
    const lower = recipeNames.map(n => n.toLowerCase());
    const notInCollection = recipeNames.filter(n => !c.recipeNames.some(r => r.toLowerCase() === n.toLowerCase()));
    const before = c.recipeNames.length;
    c.recipeNames = c.recipeNames.filter(r => !lower.includes(r.toLowerCase()));
    c.recipeCount = c.recipeNames.length;
    return { name: c.name, removed: before - c.recipeNames.length, notInCollection, ambiguous: [] };
  }
}
