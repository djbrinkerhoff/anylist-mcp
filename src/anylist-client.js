import AnyList from '../anylist-js/lib/index.js';
import { normalizeRecipe } from './recipe-normalizer.js';

class AnyListClient {
  /**
   * @param {object} [options]
   * @param {string} [options.username]
   * @param {string} [options.password]
   * @param {string} [options.defaultListName]
   *   Optional credentials. Falls back to ANYLIST_USERNAME / ANYLIST_PASSWORD / ANYLIST_LIST_NAME
   *   environment variables when not provided (stdio mode).
   * @param {(opts: { email: string, password: string }) => AnyList} [options.createAnyList]
   *   Factory for the underlying AnyList instance (e.g. one that persists tokens somewhere
   *   other than the filesystem). Defaults to `new AnyList(...)`.
   * @param {boolean} [options.connectWebSocket=true]
   *   Whether to open AnyList's realtime WebSocket on login. Not needed for MCP tool calls.
   */
  constructor({ username, password, defaultListName, createAnyList, connectWebSocket = true } = {}) {
    this.client = null;
    this.targetList = null;
    this._username = username || null;
    this._password = password || null;
    this.defaultListName = defaultListName || null;
    this._createAnyList = createAnyList || (opts => new AnyList(opts));
    this._connectWebSocket = connectWebSocket;
  }

  async connect(listName = null) {
    const username = this._username || process.env.ANYLIST_USERNAME;
    const password = this._password || process.env.ANYLIST_PASSWORD;
    const targetListName = listName || this.defaultListName || process.env.ANYLIST_LIST_NAME;

    if (!username || !password) {
      const error = new Error('Missing AnyList credentials. Provide username and password.');
      console.error(error.message);
      throw error;
    }

    if (!targetListName) {
      const error = new Error('No list name provided and no default list configured');
      console.error(error.message);
      throw error;
    }

    // If already connected to the same list, skip reconnection
    if (this.client && this.targetList && this.targetList.name === targetListName) {
      return true;
    }

    try {
      // Create AnyList client if not already authenticated
      if (!this.client) {
        this.client = this._createAnyList({
          email: username,
          password: password
        });

        // Authenticate
        console.error(`Connecting to AnyList as ${username}...`);
        await this.client.login(this._connectWebSocket);
        console.error('Successfully authenticated with AnyList');

        await this.client.getLists();
      }

      // Find the target list
      console.error(`Looking for list: "${targetListName}"`);
      this.targetList = this.client.getListByName(targetListName);

      if (!this.targetList) {
        const error = new Error(`List "${targetListName}" not found. Available lists: ${this.getAvailableListNames().join(', ')}`);
        console.error(error.message);
        throw error;
      }

      console.error(`Connected to list: "${this.targetList.name}"`);

      return true;

    } catch (error) {
      const wrappedError = new Error(`Failed to connect to AnyList: ${error.message}`);
      console.error(wrappedError.message);
      throw wrappedError;
    }
  }

  /**
   * Re-fetch lists from AnyList and re-point targetList at the fresh copy.
   * Without the realtime WebSocket, this is how long-lived sessions pick up
   * changes made in the AnyList apps.
   */
  async refresh() {
    if (!this.client) return;
    await this.client.getLists();
    if (this.targetList) {
      this.targetList = this.client.getListByName(this.targetList.name) || null;
    }
  }

  getAvailableListNames() {
    if (!this.client || !this.client.lists) return [];
    return this.client.lists.map(list => list.name);
  }

  getLists() {
    if (!this.client || !this.client.lists) return [];
    return this.client.lists.map(list => ({
      name: list.name,
      uncheckedCount: list.items ? list.items.filter(item => !item.checked).length : 0
    }));
  }

  // Known limitation: quantity only sticks for NEW items (set via _encode during
  // creation, below). For an existing item we fall back to existingItem.save(),
  // which emits a `set-list-item-quantity` op — that handler does NOT populate
  // quantityPb.rawQuantity, so the AnyList apps render no quantity change even
  // though this server reports success. Fixing it needs a full `update-list-item`
  // op (see Item.assignToCustomCategory), which is unsafe until Item._encode
  // round-trips recipeId / rawIngredient / prices / photoIds. Workaround for
  // callers: delete the item and re-add it with the new quantity.
  async addItem(itemName, quantity = 1, notes = null, category = "other", store = null) {
    if (!this.targetList) {
      const error = new Error('Not connected to any list. Call connect() first.');
      console.error(error.message);
      throw error;
    }

    try {
      // First, check if item already exists
      const existingItem = this.targetList.getItemByName(itemName);

      if (existingItem) {
        // Item exists - check if it's checked (completed)

        if (existingItem.checked) {
          // Uncheck the item to make it active again
          existingItem.checked = false;
          existingItem.quantity = quantity; // Update quantity if needed
          if (notes !== null) {
            existingItem.details = notes;
          }

          console.error(`Unchecked existing item: ${existingItem.name}`);
          existingItem.save();
        } else {

          // Item already exists and is unchecked, no action needed
          console.error(`Item "${itemName}" already exists and is active`);
          existingItem.quantity = quantity;
          if (notes !== null) {
            existingItem.details = notes;
          }
          // Category not used if item already has a category

          existingItem.save();
        }
      } else {
        // Item doesn't exist, create new one
        const itemOptions = { name: itemName };
        if (notes !== null) {
          itemOptions.details = notes;
        }
        if (category !== "other") {
          itemOptions.categoryMatchId = category;
        }
        // Carry the quantity through creation so it lands in quantityPb.rawQuantity
        // (List.addItem encodes the item). Bare "1" is AnyList's default, so skip it.
        const rawQuantity = quantity == null ? "" : String(quantity).trim();
        if (rawQuantity !== "" && rawQuantity !== "1") {
          itemOptions.quantity = rawQuantity;
        }

        const newItem = this.client.createItem(itemOptions);
        await this.targetList.addItem(newItem);

        console.error(`Added new item: ${newItem.name}`);
      }

      if (store) {
        await this.setItemStore(itemName, store);
      }

    } catch (error) {
      const wrappedError = new Error(`Failed to add item "${itemName}": ${error.message}`);
      console.error(wrappedError.message);
      throw wrappedError;
    }
  }

  async deleteItem(itemName) {
    if (!this.targetList) {
      const error = new Error('Not connected to any list. Call connect() first.');
      console.error(error.message);
      throw error;
    }

    try {
      const existingItem = this.targetList.getItemByName(itemName);

      if (!existingItem) {
        const error = new Error(`Item "${itemName}" not found in list, so can't delete it`);
        console.error(error.message);
        throw error;
      }

      await this.targetList.removeItem(existingItem);
      console.error(`Deleted item: ${existingItem.name}`);

    } catch (error) {
      const wrappedError = new Error(`Failed to delete item "${itemName}": ${error.message}`);
      console.error(wrappedError.message);
      throw wrappedError;
    }
  }

  async removeItem(itemName) {
    if (!this.targetList) {
      const error = new Error('Not connected to any list. Call connect() first.');
      console.error(error.message);
      throw error;
    }

    try {
      // Find the item by name
      const existingItem = this.targetList.getItemByName(itemName);

      if (!existingItem) {
        const error = new Error(`Item "${itemName}" not found in list, so can't check it`);
        console.error(error.message);
        throw error;
      }

      // Check the item (mark as completed) instead of deleting
      if (!existingItem.checked) {
        existingItem.checked = true;
        await existingItem.save();
        console.error(`Checked off item: ${existingItem.name}`);
      } else {
        console.error(`Item "${itemName}" is already checked off`);
      }
    } catch (error) {
      const wrappedError = new Error(`Failed to remove item "${itemName}": ${error.message}`);
      console.error(wrappedError.message);
      throw wrappedError;
    }
  }

  async uncheckItem(itemName) {
    if (!this.targetList) {
      const error = new Error('Not connected to any list. Call connect() first.');
      console.error(error.message);
      throw error;
    }

    try {
      const existingItem = this.targetList.getItemByName(itemName);

      if (!existingItem) {
        const error = new Error(`Item "${itemName}" not found in list, so can't uncheck it`);
        console.error(error.message);
        throw error;
      }

      // Uncheck the item (mark as active again). No-op if already unchecked.
      if (existingItem.checked) {
        existingItem.checked = false;
        await existingItem.save();
        console.error(`Unchecked item: ${existingItem.name}`);
      } else {
        console.error(`Item "${itemName}" is already unchecked`);
      }
    } catch (error) {
      const wrappedError = new Error(`Failed to uncheck item "${itemName}": ${error.message}`);
      console.error(wrappedError.message);
      throw wrappedError;
    }
  }

  async getItems(includeChecked = false, includeNotes = false) {
    if (!this.targetList) {
      const error = new Error('Not connected to any list. Call connect() first.');
      console.error(error.message);
      throw error;
    }

    try {
      // Get all items from the list
      const items = this.targetList.items || [];

      // Filter based on checked status
      const filteredItems = includeChecked
        ? items
        : items.filter(item => !item.checked);

      // Map to a clean format
      return filteredItems.map(item => {
        const result = {
          name: item.name,
          quantity: item.quantity ?? null,
          checked: item.checked || false,
          category: item.categoryMatchId || 'other'
        };
        if (includeNotes && item.details) {
          result.note = item.details;
        }
        const store = (this.targetList.stores || []).find(s => s.identifier === item.storeIds[0]);
        result.store = store ? store.name : null;
        
        return result;
      });
    } catch (error) {
      const wrappedError = new Error(`Failed to get items: ${error.message}`);
      console.error(wrappedError.message);
      throw wrappedError;
    }
  }

  _buildCategoryMap() {
    const categoryMap = {};
    try {
      // Access the raw user data from the client to get category groups
      const userData = this.client._userData;
      if (userData && userData.shoppingListsResponse && userData.shoppingListsResponse.categoryGroupResponses) {
        for (const groupResponse of userData.shoppingListsResponse.categoryGroupResponses) {
          if (groupResponse.categoryGroup && groupResponse.categoryGroup.categories) {
            for (const category of groupResponse.categoryGroup.categories) {
              if (category.identifier && category.name) {
                categoryMap[category.identifier] = category.name;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to build category map: ${error.message}`);
    }
    return categoryMap;
  }

  // ===== STORES =====

  getStores() {
    if (!this.targetList) {
      throw new Error('Not connected to any list. Call connect() first.');
    }
    return this.targetList.stores || [];
  }

  async setItemStore(itemName, storeName) {
    if (!this.targetList) {
      throw new Error('Not connected to any list. Call connect() first.');
    }
    const item = this.targetList.getItemByName(itemName);
    if (!item) {
      throw new Error(`Item "${itemName}" not found in list`);
    }
    let storeIds = [];
    if (storeName) {
      const store = this.targetList.findStoreByName(storeName);
      if (!store) {
        const available = (this.targetList.stores || []).map(s => s.name).join(', ') || 'none';
        throw new Error(`Store "${storeName}" not found. Available stores: ${available}`);
      }
      storeIds = [store.identifier];
    }
    await item.setStores(storeIds);
  }

  async createStore(storeName) {
    if (!this.targetList) {
      throw new Error('Not connected to any list. Call connect() first.');
    }
    try {
      const store = await this.targetList.createStore(storeName);
      console.error(`Created store: ${store.name}`);
      return store;
    } catch (error) {
      throw new Error(`Failed to create store "${storeName}": ${error.message}`);
    }
  }

  async deleteStore(storeName) {
    if (!this.targetList) {
      throw new Error('Not connected to any list. Call connect() first.');
    }
    const store = this.targetList.findStoreByName(storeName);
    if (!store) {
      throw new Error(`Store "${storeName}" not found`);
    }
    try {
      await this.targetList.deleteStore(store.identifier);
      console.error(`Deleted store: ${storeName}`);
    } catch (error) {
      throw new Error(`Failed to delete store "${storeName}": ${error.message}`);
    }
  }

  // ===== RECIPES =====

  /**
   * Find the one recipe matching `recipeId` (exact identifier) or, when no id
   * is given, `recipeName` (case-insensitive). Throws if none match, or if the
   * name matches several recipes — listing their ids so the caller can retry
   * with one.
   */
  _findRecipe(recipes, recipeName, recipeId = null) {
    if (recipeId) {
      const recipe = recipes.find(r => r.identifier === recipeId);
      if (!recipe) throw new Error(`Recipe with id "${recipeId}" not found`);
      return recipe;
    }
    const matches = recipes.filter(r => r.name && r.name.toLowerCase() === recipeName.toLowerCase());
    if (matches.length === 0) {
      throw new Error(`Recipe "${recipeName}" not found`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple recipes named "${recipeName}" (${matches.length}) exist (ids: ${matches.map(r => r.identifier).join(', ')}). Pass recipe_id to choose one.`);
    }
    return matches[0];
  }

  async getRecipes(searchQuery = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const recipes = await this.client.getRecipes();
      let results = recipes.map(r => ({
        identifier: r.identifier,
        name: r.name,
        note: r.note || null,
        sourceName: r.sourceName || null,
        sourceUrl: r.sourceUrl || null,
        rating: r.rating || null,
        prepTime: r.prepTime || null,
        cookTime: r.cookTime || null,
        servings: r.servings || null,
        ingredientCount: r.ingredients ? r.ingredients.length : 0,
        stepCount: r.preparationSteps ? r.preparationSteps.length : 0,
      }));
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        results = results.filter(r => r.name && r.name.toLowerCase().includes(q));
      }
      return results;
    } catch (error) {
      throw new Error(`Failed to get recipes: ${error.message}`);
    }
  }

  async getRecipeDetails(recipeName, recipeId = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const recipes = await this.client.getRecipes();
      const recipe = this._findRecipe(recipes, recipeName, recipeId);
      return {
        identifier: recipe.identifier,
        name: recipe.name,
        note: recipe.note || null,
        sourceName: recipe.sourceName || null,
        sourceUrl: recipe.sourceUrl || null,
        rating: recipe.rating || null,
        prepTime: recipe.prepTime || null,
        cookTime: recipe.cookTime || null,
        servings: recipe.servings || null,
        nutritionalInfo: recipe.nutritionalInfo || null,
        createdAt: recipe.creationTimestamp
          ? new Date(recipe.creationTimestamp * 1000).toISOString()
          : (recipe.timestamp ? new Date(recipe.timestamp * 1000).toISOString() : null),
        ingredients: recipe.ingredients ? recipe.ingredients.map(i => ({
          rawIngredient: i.rawIngredient || null,
          name: i.name || null,
          quantity: i.quantity || null,
          note: i.note || null,
          isHeading: !!i.isHeading,
        })) : [],
        preparationSteps: recipe.preparationSteps || [],
      };
    } catch (error) {
      throw new Error(`Failed to get recipe details: ${error.message}`);
    }
  }

  /**
   * Every ingredient line of every recipe, with its recipe. Section headings
   * ("For the sauce") are included with isHeading set.
   * @param {Date|null} since - only recipes added at or after this time. Recipes
   *   with no creation time (some very old ones) never match: their other
   *   timestamp changes on every edit, so it can't stand in.
   */
  async getAllIngredients(since = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      let recipes = await this.client.getRecipes();
      if (since) recipes = recipes.filter(r => r.creationTimestamp && r.creationTimestamp * 1000 >= since.getTime());
      return recipes.flatMap(r => (r.ingredients || []).map(i => {
        const ing = i.toJSON();
        return {
          recipeId: r.identifier,
          recipeName: r.name,
          name: ing.name || null,
          quantity: ing.quantity || null,
          note: ing.note || null,
          rawIngredient: ing.rawIngredient || null,
          isHeading: !!ing.isHeading,
        };
      }));
    } catch (error) {
      throw new Error(`Failed to get ingredients: ${error.message}`);
    }
  }

  async importRecipeFromUrl(url) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Try AnyList's native web import first
    let nativeError = null;
    try {
      const result = await this.client.client.post('data/recipes/web-import?url=' + encodeURIComponent(url));
      const decoded = this.client.protobuf.PBRecipeWebImportResponse.decode(result.body);

      if (decoded.statusCode === 0 && decoded.recipe) {
        // Native import succeeded
        const recipe = await this.client.createRecipe({
          name: decoded.recipe.name,
          note: decoded.recipe.note || null,
          sourceName: decoded.recipe.sourceName || null,
          sourceUrl: decoded.recipe.sourceUrl || url,
          prepTime: decoded.recipe.prepTime || null,
          cookTime: decoded.recipe.cookTime || null,
          servings: decoded.recipe.servings || null,
          nutritionalInfo: decoded.recipe.nutritionalInfo || null,
          rating: decoded.recipe.rating || null,
          ingredients: decoded.recipe.ingredients || [],
          preparationSteps: decoded.recipe.preparationSteps || [],
        });
        recipe.isNewRecipeFromWebImport = true;
        recipe.creationTimestamp = Date.now() / 1000;
        await recipe.save();
        console.error(`Imported recipe from URL (native): ${recipe.name}`);

        return {
          name: recipe.name,
          identifier: recipe.identifier,
          ingredientCount: decoded.recipe.ingredients?.length || 0,
          stepCount: decoded.recipe.preparationSteps?.length || 0,
          source: decoded.recipe.sourceName || null,
          sourceUrl: decoded.recipe.sourceUrl || url,
          isPremiumUser: decoded.isPremiumUser,
          freeImportsRemaining: decoded.freeRecipeImportsRemainingCount,
          method: 'native',
        };
      }
      nativeError = decoded.siteSpecificHelpText || 'Native import returned no recipe';
    } catch (error) {
      nativeError = error.message;
    }

    // Fallback: use normalizer
    console.error(`Native import failed (${nativeError}), trying normalizer fallback...`);
    try {
      const normalized = await normalizeRecipe({ url });
      const created = await this.createRecipe({
        name: normalized.name,
        ingredients: normalized.ingredients,
        preparationSteps: normalized.preparationSteps,
        note: normalized.note,
        sourceName: normalized.sourceName,
        sourceUrl: normalized.sourceUrl || url,
        prepTime: normalized.prepTime,
        cookTime: normalized.cookTime,
        servings: normalized.servings,
      });
      console.error(`Imported recipe from URL (normalizer fallback): ${created.name}`);

      return {
        name: created.name,
        identifier: created.identifier,
        ingredientCount: normalized.ingredients.length,
        stepCount: normalized.preparationSteps.length,
        source: normalized.sourceName || null,
        sourceUrl: normalized.sourceUrl || url,
        method: 'normalizer',
      };
    } catch (fallbackError) {
      throw new Error(`Failed to import recipe from URL: native import failed (${nativeError}), normalizer also failed (${fallbackError.message})`);
    }
  }

  async createRecipe({ name, ingredients = [], preparationSteps = [], note = null, sourceName = null, sourceUrl = null, prepTime = null, cookTime = null, servings = null }) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const nowSecs = Date.now() / 1000;
      const recipeObj = { name, creationTimestamp: nowSecs };
      if (note) recipeObj.note = note;
      if (sourceName) recipeObj.sourceName = sourceName;
      if (sourceUrl) recipeObj.sourceUrl = sourceUrl;
      if (prepTime) recipeObj.prepTime = prepTime;
      if (cookTime) recipeObj.cookTime = cookTime;
      if (servings) recipeObj.servings = servings;
      if (preparationSteps.length > 0) recipeObj.preparationSteps = preparationSteps;
      if (ingredients.length > 0) {
        recipeObj.ingredients = ingredients.map(i => ({
          rawIngredient: typeof i === 'string' ? i : i.rawIngredient || `${i.quantity || ''} ${i.name || ''}`.trim(),
          name: typeof i === 'string' ? i : (i.name || i.rawIngredient || null),
          quantity: typeof i === 'string' ? null : i.quantity || null,
          note: typeof i === 'string' ? null : i.note || null,
        }));
      }
      const recipe = await this.client.createRecipe(recipeObj);
      await recipe.save();
      console.error(`Created recipe: ${recipe.name}`);
      return { identifier: recipe.identifier, name: recipe.name };
    } catch (error) {
      throw new Error(`Failed to create recipe: ${error.message}`);
    }
  }

  /**
   * Partially update an existing recipe in place.
   *
   * Only the fields present in `fields` are changed; every other field
   * (identifier, note, photos, rating, timestamps, and any field not passed)
   * is carried over from the existing recipe. This is a real in-place update
   * (`save-recipe` on the same identifier), NOT a delete + recreate, so recipe
   * collection membership and meal-plan links that reference the recipe id
   * survive untouched.
   *
   * `ingredients` and `preparationSteps`, when provided, REPLACE the existing
   * array wholesale — they are not merged item-by-item.
   *
   * @param {string} recipeName - name identifying the recipe to update
   * @param {object} fields - subset of { name, note, sourceName, sourceUrl,
   *   prepTime, cookTime, servings, ingredients, preparationSteps }; keys with an
   *   `undefined` value are ignored. `name` renames the recipe in place.
   * @param {string|null} recipeId - identifier to target instead of the name
   */
  async updateRecipe(recipeName, fields = {}, recipeId = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const recipes = await this.client.getRecipes();
      const existing = this._findRecipe(recipes, recipeName, recipeId);
      if (fields.name !== undefined && recipes.some(r => r !== existing && r.name && r.name.toLowerCase() === fields.name.toLowerCase())) {
        throw new Error(`Cannot rename to "${fields.name}": a recipe with that name already exists.`);
      }

      // Start from every existing field so nothing is lost on save, then
      // override only the provided fields.
      const merged = this._recipeFields(existing);

      for (const key of ['name', 'note', 'sourceName', 'sourceUrl', 'prepTime', 'cookTime', 'servings', 'preparationSteps']) {
        if (fields[key] !== undefined) merged[key] = fields[key];
      }
      if (fields.ingredients !== undefined) {
        merged.ingredients = fields.ingredients.map(i => ({
          rawIngredient: typeof i === 'string' ? i : i.rawIngredient || `${i.quantity || ''} ${i.name || ''}`.trim(),
          name: typeof i === 'string' ? i : (i.name || i.rawIngredient || null),
          quantity: typeof i === 'string' ? null : i.quantity || null,
          note: typeof i === 'string' ? null : i.note || null,
        }));
      }

      const recipe = await this.client.createRecipe(merged);
      await recipe.save();
      console.error(`Updated recipe: ${recipe.name}`);
      return { identifier: recipe.identifier, name: recipe.name };
    } catch (error) {
      throw new Error(`Failed to update recipe: ${error.message}`);
    }
  }

  /**
   * Every stored field of a recipe, ready to save back. Existing ingredients
   * are serialized via toJSON() to preserve their identifiers and headings.
   */
  _recipeFields(existing) {
    return {
      identifier: existing.identifier,
      name: existing.name,
      note: existing.note,
      sourceName: existing.sourceName,
      sourceUrl: existing.sourceUrl,
      prepTime: existing.prepTime,
      cookTime: existing.cookTime,
      servings: existing.servings,
      rating: existing.rating,
      nutritionalInfo: existing.nutritionalInfo,
      scaleFactor: existing.scaleFactor,
      paprikaIdentifier: existing.paprikaIdentifier,
      creationTimestamp: existing.creationTimestamp,
      photoIds: existing.photoIds,
      photoUrls: existing.photoUrls,
      preparationSteps: existing.preparationSteps,
      ingredients: existing.ingredients.map(i => i.toJSON()),
    };
  }

  /**
   * Edit individual ingredient lines in place, across any number of recipes.
   * Each change finds a line by its current text (`match`, exact) in recipe
   * `recipeId` and sets only the fields it provides: `text` (the line as
   * shown), `name`, `quantity`, `note`, `isHeading`. Everything else,
   * including the ingredient's identifier and position, is kept. When the
   * same text appears more than once in a recipe, successive changes take
   * successive occurrences.
   * @returns {{ recipesSaved: number, linesChanged: number, unmatched: object[] }}
   */
  async updateIngredients(changes) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const recipes = await this.client.getRecipes();
      const byRecipe = new Map();
      for (const c of changes) {
        if (!byRecipe.has(c.recipeId)) byRecipe.set(c.recipeId, []);
        byRecipe.get(c.recipeId).push(c);
      }
      let recipesSaved = 0, linesChanged = 0;
      const unmatched = [];
      for (const [recipeId, list] of byRecipe) {
        const existing = recipes.find(r => r.identifier === recipeId);
        if (!existing) { unmatched.push(...list.map(c => ({ ...c, reason: 'recipe not found' }))); continue; }
        const fields = this._recipeFields(existing);
        const used = new Set();
        let changed = 0;
        for (const c of list) {
          const idx = fields.ingredients.findIndex((ing, k) => !used.has(k) && ing.rawIngredient === c.match);
          if (idx === -1) { unmatched.push({ ...c, reason: 'line not found' }); continue; }
          used.add(idx);
          const ing = fields.ingredients[idx];
          if (c.text !== undefined) ing.rawIngredient = c.text;
          for (const key of ['name', 'quantity', 'note', 'isHeading']) {
            if (c[key] !== undefined) ing[key] = c[key];
          }
          changed++;
        }
        if (changed === 0) continue;
        const recipe = await this.client.createRecipe(fields);
        await recipe.save();
        recipesSaved++; linesChanged += changed;
      }
      console.error(`Updated ${linesChanged} ingredient lines in ${recipesSaved} recipes`);
      return { recipesSaved, linesChanged, unmatched };
    } catch (error) {
      throw new Error(`Failed to update ingredients: ${error.message}`);
    }
  }

  async deleteRecipe(recipeName, recipeId = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const recipes = await this.client.getRecipes();
      const recipe = this._findRecipe(recipes, recipeName, recipeId);
      await recipe.delete();
      console.error(`Deleted recipe: ${recipe.name}`);
    } catch (error) {
      throw new Error(`Failed to delete recipe: ${error.message}`);
    }
  }

  // ===== MEAL PLANNING =====

  async getMealPlanEvents() {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const events = await this.client.getMealPlanningCalendarEvents();
      return events.map(e => ({
        identifier: e.identifier,
        date: e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date),
        title: e.title || null,
        details: e.details || null,
        labelName: e.label ? e.label.name : null,
        labelColor: e.label ? e.label.hexColor : null,
        recipeName: e.recipe ? e.recipe.name : null,
        recipeId: e.recipeId || null,
      }));
    } catch (error) {
      throw new Error(`Failed to get meal plan events: ${error.message}`);
    }
  }

  async getMealPlanLabels() {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      await this.client.getMealPlanningCalendarEvents();
      return (this.client.mealPlanningCalendarEventLabels || []).map(l => ({
        identifier: l.identifier,
        name: l.name,
        hexColor: l.hexColor,
        sortIndex: l.sortIndex,
      }));
    } catch (error) {
      throw new Error(`Failed to get meal plan labels: ${error.message}`);
    }
  }

  async createMealPlanEvent({ date, title = null, recipeId = null, labelId = null, details = null }) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const eventObj = { date: new Date(`${date}T12:00:00`) };
      if (title) eventObj.title = title;
      if (recipeId) eventObj.recipeId = recipeId;
      if (labelId) eventObj.labelId = labelId;
      if (details) eventObj.details = details;
      const event = await this.client.createEvent(eventObj);
      await event.save();
      console.error(`Created meal plan event for ${date}`);
      return { identifier: event.identifier, date: date };
    } catch (error) {
      throw new Error(`Failed to create meal plan event: ${error.message}`);
    }
  }

  /**
   * Change only the provided fields of an existing event. AnyList's in-place
   * update (`set-event-details`) ignores date and recipe changes, so this saves
   * a new event with the merged fields and deletes the old one; the event id
   * changes.
   * @param {object} fields - subset of { date, title, recipeId, labelId, details };
   *   `undefined` keys are ignored, `null` clears the field.
   */
  async updateMealPlanEvent(eventId, fields = {}) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const events = await this.client.getMealPlanningCalendarEvents();
      const old = events.find(e => e.identifier === eventId);
      if (!old) {
        throw new Error(`Meal plan event "${eventId}" not found`);
      }
      const pick = key => (fields[key] !== undefined ? fields[key] : old[key]);
      const event = await this.client.createEvent({
        date: fields.date !== undefined ? new Date(`${fields.date}T12:00:00`) : old.date,
        title: pick('title') || undefined,
        recipeId: pick('recipeId') || undefined,
        labelId: pick('labelId') || undefined,
        details: pick('details') || undefined,
      });
      await event.save();
      await old.delete();
      console.error(`Replaced meal plan event ${eventId} with ${event.identifier}`);
      return { identifier: event.identifier };
    } catch (error) {
      throw new Error(`Failed to update meal plan event: ${error.message}`);
    }
  }

  async deleteMealPlanEvent(eventId) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const events = await this.client.getMealPlanningCalendarEvents();
      const event = events.find(e => e.identifier === eventId);
      if (!event) {
        throw new Error(`Meal plan event "${eventId}" not found`);
      }
      await event.delete();
      console.error(`Deleted meal plan event: ${eventId}`);
    } catch (error) {
      throw new Error(`Failed to delete meal plan event: ${error.message}`);
    }
  }

  // ===== FAVORITES & RECENTS =====

  async getFavoriteItems(listName) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      await this.connect(listName);
      const favList = this.client.getFavoriteItemsByListId(this.targetList.identifier);
      if (!favList || !favList.items) {
        return [];
      }
      return favList.items.map(i => ({
        name: i.name,
        details: i.details || null,
      }));
    } catch (error) {
      throw new Error(`Failed to get favorite items: ${error.message}`);
    }
  }

  async getRecentItems(listName) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      await this.connect(listName);
      const items = this.client.getRecentItemsByListId(this.targetList.identifier);
      if (!items) {
        return [];
      }
      return items.map(i => ({
        name: i.name,
        details: i.details || null,
      }));
    } catch (error) {
      throw new Error(`Failed to get recent items: ${error.message}`);
    }
  }

  // ===== RECIPE COLLECTIONS =====

  async getRecipeCollections() {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const userData = await this.client._getUserData(true);
      const collections = userData.recipeDataResponse.recipeCollections || [];
      const recipes = await this.client.getRecipes();
      return collections.map(c => ({
        identifier: c.identifier,
        name: c.name,
        recipeCount: c.recipeIds ? c.recipeIds.length : 0,
        recipeNames: (c.recipeIds || []).map(id => {
          const r = recipes.find(r => r.identifier === id);
          return r ? r.name : id;
        }),
      }));
    } catch (error) {
      throw new Error(`Failed to get recipe collections: ${error.message}`);
    }
  }

  /**
   * Map recipe names to ids. A name matching no recipe goes in `missing`;
   * a name shared by several recipes goes in `ambiguous` (use distinct names).
   */
  _resolveRecipeNames(recipes, recipeNames) {
    const ids = [];
    const missing = [];
    const ambiguous = [];
    for (const rName of recipeNames) {
      const matches = recipes.filter(r => r.name && r.name.toLowerCase() === rName.toLowerCase());
      if (matches.length === 0) missing.push(rName);
      else if (matches.length > 1) ambiguous.push(rName);
      else ids.push(matches[0].identifier);
    }
    return { ids, missing, ambiguous };
  }

  /**
   * Load recipes and the one collection matching `collectionId` or `name`.
   * Loading recipes also sets client.recipeDataId, which every collection
   * operation needs: without it AnyList accepts the request but does nothing.
   */
  async _loadRecipeCollection(name, collectionId = null) {
    const recipes = await this.client.getRecipes();
    const userData = await this.client._getUserData(false);
    const collections = userData.recipeDataResponse.recipeCollections || [];
    if (collectionId) {
      const raw = collections.find(c => c.identifier === collectionId);
      if (!raw) throw new Error(`Recipe collection with id "${collectionId}" not found`);
      return { recipes, raw };
    }
    const matches = collections.filter(c => c.name && c.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 0) throw new Error(`Recipe collection "${name}" not found`);
    if (matches.length > 1) {
      throw new Error(`Multiple collections named "${name}" (${matches.length}) exist (ids: ${matches.map(c => c.identifier).join(', ')}). Pass collection_id to choose one.`);
    }
    return { recipes, raw: matches[0] };
  }

  _collectionWithRecipeIds(raw, recipeIds) {
    return this.client.createRecipeCollection({
      identifier: raw.identifier,
      timestamp: raw.timestamp,
      name: raw.name,
      recipeIds,
      collectionSettings: raw.collectionSettings,
    });
  }

  async createRecipeCollection(name, recipeNames = []) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      // Always load recipes: it sets the recipeDataId the save needs.
      const recipes = await this.client.getRecipes();
      const { ids, missing, ambiguous } = this._resolveRecipeNames(recipes, recipeNames);
      const collection = this.client.createRecipeCollection({ name, recipeIds: ids });
      await collection.save();
      console.error(`Created recipe collection: ${name}`);
      return { identifier: collection.identifier, name: collection.name, recipeCount: ids.length, missing, ambiguous };
    } catch (error) {
      throw new Error(`Failed to create recipe collection: ${error.message}`);
    }
  }

  async deleteRecipeCollection(name, collectionId = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const { raw } = await this._loadRecipeCollection(name, collectionId);
      await this._collectionWithRecipeIds(raw, raw.recipeIds || []).delete();
      console.error(`Deleted recipe collection: ${raw.name}`);
      return { identifier: raw.identifier, name: raw.name };
    } catch (error) {
      throw new Error(`Failed to delete recipe collection: ${error.message}`);
    }
  }

  async addRecipesToCollection(name, recipeNames, collectionId = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const { recipes, raw } = await this._loadRecipeCollection(name, collectionId);
      const { ids, missing, ambiguous } = this._resolveRecipeNames(recipes, recipeNames);
      const existing = raw.recipeIds || [];
      const toAdd = [...new Set(ids.filter(id => !existing.includes(id)))];
      if (toAdd.length > 0) {
        await this._collectionWithRecipeIds(raw, [...existing, ...toAdd]).performOperation('add-recipes-to-collection');
      }
      console.error(`Added ${toAdd.length} recipes to collection: ${raw.name}`);
      return { name: raw.name, added: toAdd.length, alreadyIn: ids.length - toAdd.length, missing, ambiguous };
    } catch (error) {
      throw new Error(`Failed to add recipes to collection: ${error.message}`);
    }
  }

  async removeRecipesFromCollection(name, recipeNames, collectionId = null) {
    if (!this.client) {
      throw new Error('Not connected. Call connect() first.');
    }
    try {
      const { recipes, raw } = await this._loadRecipeCollection(name, collectionId);
      const existing = raw.recipeIds || [];
      // Resolve against the collection's own recipes, so a name shared with a
      // recipe outside the collection is still unambiguous here.
      const members = recipes.filter(r => existing.includes(r.identifier));
      const { ids, missing, ambiguous } = this._resolveRecipeNames(members, recipeNames);
      const toRemove = [...new Set(ids)];
      if (toRemove.length > 0) {
        // The operation removes the recipe ids it is given.
        await this._collectionWithRecipeIds(raw, toRemove).performOperation('remove-recipes-from-collection');
      }
      console.error(`Removed ${toRemove.length} recipes from collection: ${raw.name}`);
      return { name: raw.name, removed: toRemove.length, notInCollection: missing, ambiguous };
    } catch (error) {
      throw new Error(`Failed to remove recipes from collection: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.teardown();
        console.error('Disconnected from AnyList');
      } catch (error) {
        const wrappedError = new Error(`Error during disconnect: ${error.message}`);
        console.error(wrappedError.message);
        throw wrappedError;
      }
    }
    this.client = null;
    this.targetList = null;
  }
}

export default AnyListClient;
