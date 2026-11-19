(() => {
  "use strict";

  const EXPORT_ROOT = "./jei-exports/jei-exports/";
  const VIEWER_ROOT = `${EXPORT_ROOT}viewer/`;
  const PAGE_SIZE = 120;
  const CHUNK_SIZE = 256;
  const MAX_TREE_DEPTH = 10;
  const MAX_TREE_NODES = 2500;
  const FAVORITES_STORAGE_KEY = "recipe-tree:favorites:v1";
  const THEME_STORAGE_KEY = "recipe-tree:theme:v1";
  const $ = (selector) => document.querySelector(selector);

  const state = {
    catalog: null,
    imageProbe: Promise.resolve(false),
    recipeImagesAvailable: false,
    items: [],
    itemByKey: new Map(),
    favorites: new Set(),
    theme: "dark",
    recipeRefs: null,
    categoryByIndex: [],
    chunks: new Map(),
    selectedItem: null,
    view: "items",
    visibleCount: PAGE_SIZE,
    tree: null,
    treeNodes: 0,
    nodeSequence: 0,
    recipeOverrides: new Map(),
    resourceKeys: new Set(),
    treeTruncated: false,
    resources: [],
    resourcesComplete: false,
    searchTimer: 0
  };

  const els = {
    notice: $("#app-notice"),
    search: $("#search-input"),
    modFilter: $("#mod-filter"),
    grid: $("#item-grid"),
    resultsCount: $("#results-count"),
    loadMore: $("#load-more"),
    panel: $("#item-panel"),
    details: $("#item-details"),
    treeRoot: $("#tree-root"),
    treeCaption: $("#tree-caption"),
    treeProgress: $("#tree-progress"),
    expandTree: $("#expand-tree"),
    collapseTree: $("#collapse-tree"),
    resourceList: $("#resource-list"),
    resourceCaption: $("#resource-caption"),
    exportResources: $("#export-resources"),
    catalogTitle: $("#catalog-title"),
    favoritesCount: $("#favorites-count"),
    settingsButton: $("#settings-button"),
    settingsMenu: $("#settings-menu"),
    themeToggle: $("#theme-toggle"),
    favoritesFile: $("#favorites-file")
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function itemFor(key) {
    return state.itemByKey.get(key);
  }

  function itemName(key) {
    const item = itemFor(key);
    if (item) return item[1];
    return String(key).split("|").pop().replace(/^[^:]+:/, "").replace(/[_/]/g, " ");
  }

  function itemId(key) {
    return String(key).split("|").pop();
  }

  function iconPath(key) {
    const item = itemFor(key);
    return item && item[3] ? `${EXPORT_ROOT}${item[3]}` : "";
  }

  function itemIcon(key, className = "") {
    const src = iconPath(key);
    return src
      ? `<img class="${className}" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.hidden=true">`
      : `<span class="item-image-fallback ${className}" aria-hidden="true">◇</span>`;
  }

  function showNotice(message, isError = false) {
    els.notice.hidden = !message;
    els.notice.classList.toggle("error-notice", isError);
    els.notice.textContent = message;
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.view === view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });
    document.querySelectorAll(".view").forEach((section) => {
      const sectionView = view === "favorites" ? "items" : view;
      section.hidden = section.id !== `${sectionView}-view`;
    });
    if (view === "resources") renderResources();
    if (view === "items" || view === "favorites") renderItems(true);
  }

  function updateFavoritesCount() {
    els.favoritesCount.textContent = state.favorites.size.toLocaleString();
  }

  function loadSavedPreferences() {
    let theme = "dark";
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === "light" || savedTheme === "dark") theme = savedTheme;
      const savedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (savedFavorites) {
        const keys = JSON.parse(savedFavorites);
        if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
          throw new Error("Saved favorites must be a list of item IDs.");
        }
        state.favorites = new Set(keys.filter((key) => state.itemByKey.has(key)));
      }
    } catch (error) {
      showNotice(`Could not load saved settings: ${error.message}`, true);
      state.favorites.clear();
    }
    applyTheme(theme, false);
    updateFavoritesCount();
  }

  function applyTheme(theme, persist = true) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    els.themeToggle.textContent = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor.content = theme === "dark" ? "#111713" : "#f4f7f4";
    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch (error) {
        showNotice(`Theme changed, but could not save the setting: ${error.message}`, true);
      }
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
      return true;
    } catch (error) {
      showNotice(`Could not save favorites in this browser: ${error.message}`, true);
      return false;
    }
  }

  function toggleFavorite(key) {
    const wasFavorite = state.favorites.has(key);
    if (wasFavorite) state.favorites.delete(key);
    else state.favorites.add(key);
    if (!saveFavorites()) {
      if (wasFavorite) state.favorites.add(key);
      else state.favorites.delete(key);
      return;
    }
    updateFavoritesCount();
    renderItems();
    updateItemDetailsFavorite(key);
  }

  function favoriteButtonHtml(key, className = "favorite-toggle") {
    const favorite = state.favorites.has(key);
    const name = itemName(key);
    return `<button class="${className}" type="button" data-favorite-key="${escapeHtml(key)}" aria-pressed="${favorite}" aria-label="${favorite ? "Remove" : "Add"} ${escapeHtml(name)} ${favorite ? "from" : "to"} favorites" title="${favorite ? "Remove from favorites" : "Add to favorites"}">${favorite ? "★" : "☆"}</button>`;
  }

  function updateItemDetailsFavorite(key) {
    const button = els.details.querySelector(".detail-favorite");
    if (!button || button.dataset.favoriteKey !== key) return;
    const favorite = state.favorites.has(key);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute("aria-label", `${favorite ? "Remove" : "Add"} ${itemName(key)} ${favorite ? "from" : "to"} favorites`);
    button.title = favorite ? "Remove from favorites" : "Add to favorites";
    button.textContent = favorite ? "★" : "☆";
  }

  function exportFavorites() {
    const data = {
      format: "recipe-tree-favorites",
      version: 1,
      items: [...state.favorites]
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "recipe-tree-favorites.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFavorites(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== "recipe-tree-favorites" || data.version !== 1 ||
          !Array.isArray(data.items) || data.items.some((key) => typeof key !== "string")) {
        throw new Error("Choose a Recipe Tree favorites JSON file.");
      }
      const imported = new Set(data.items.filter((key) => state.itemByKey.has(key)));
      const previous = state.favorites;
      state.favorites = imported;
      if (!saveFavorites()) {
        state.favorites = previous;
        return;
      }
      updateFavoritesCount();
      renderItems(true);
      const unavailable = data.items.length - imported.size;
      showNotice(`Imported ${imported.size.toLocaleString()} favorite${imported.size === 1 ? "" : "s"}${unavailable > 0 ? `; ${unavailable.toLocaleString()} item${unavailable === 1 ? "" : "s"} were not in this modpack` : ""}.`);
    } catch (error) {
      showNotice(`Could not import favorites: ${error.message}`, true);
    } finally {
      els.favoritesFile.value = "";
    }
  }

  function buildModFilter() {
    const mods = [...new Set(state.items.map((item) => item[2]).filter(Boolean))]
      .sort((a, b) => modName(a).localeCompare(modName(b)));
    const fragment = document.createDocumentFragment();
    for (const mod of mods) {
      const option = document.createElement("option");
      option.value = mod;
      option.textContent = modName(mod);
      fragment.append(option);
    }
    els.modFilter.append(fragment);
    els.modFilter.disabled = false;
  }

  function modName(mod) {
    return state.catalog.mods?.[mod] || mod;
  }

  function renderItems(reset = false) {
    if (!state.catalog) return;
    if (reset) state.visibleCount = PAGE_SIZE;
    const query = els.search.value.trim().toLocaleLowerCase();
    const queryTerms = query.split(/\s+/).filter(Boolean);
    const modTerms = queryTerms.filter((term) => term.startsWith("@")).map((term) => term.slice(1));
    const itemTerms = queryTerms.filter((term) => !term.startsWith("@"));
    const selectedMod = els.modFilter.value;
    const matches = [];
    for (const item of state.items) {
      if (selectedMod && item[2] !== selectedMod) continue;
      if (state.view === "favorites" && !state.favorites.has(item[0])) continue;
      const modText = `${item[2]} ${modName(item[2])}`.toLocaleLowerCase();
      if (modTerms.some((term) => !modText.includes(term))) continue;
      const itemText = `${item[1]} ${item[0]} ${modName(item[2])}`.toLocaleLowerCase();
      if (itemTerms.some((term) => !itemText.includes(term))) continue;
      matches.push(item);
    }
    matches.sort((a, b) => a[1].localeCompare(b[1]));
    const shown = matches.slice(0, state.visibleCount);
    const fragment = document.createDocumentFragment();
    for (const item of shown) {
      const card = document.createElement("article");
      card.className = "item-card";
      card.innerHTML = `<button class="item-card-open" type="button" data-item-key="${escapeHtml(item[0])}" aria-label="Open ${escapeHtml(item[1])}, ${escapeHtml(modName(item[2]))}">${itemIcon(item[0])}<span class="item-card-name">${escapeHtml(item[1])}</span><span class="item-card-mod">${escapeHtml(modName(item[2]))}</span></button>${favoriteButtonHtml(item[0])}`;
      fragment.append(card);
    }
    if (state.view === "favorites" && matches.length === 0) {
      els.grid.innerHTML = `<div class="empty-state compact item-grid-empty"><span class="empty-symbol" aria-hidden="true">☆</span><strong>No matching favorites</strong><span>Use the star on any item to keep it here.</span></div>`;
    } else {
      els.grid.replaceChildren(fragment);
    }
    els.catalogTitle.textContent = state.view === "favorites" ? "Favorites" : "Item catalog";
    els.resultsCount.textContent = query || selectedMod
      ? `${shown.length.toLocaleString()} of ${matches.length.toLocaleString()} matching items`
      : state.view === "favorites"
        ? `${matches.length.toLocaleString()} saved item${matches.length === 1 ? "" : "s"}`
        : `${state.items.length.toLocaleString()} items · showing ${shown.length.toLocaleString()}`;
    els.loadMore.hidden = shown.length >= matches.length;
    els.loadMore.textContent = `Show ${Math.min(PAGE_SIZE, matches.length - shown.length).toLocaleString()} more items`;
  }

  async function loadRecipeRefs() {
    if (state.recipeRefs) return state.recipeRefs;
    state.recipeRefs = await fetchGzipJson(`${VIEWER_ROOT}recipe-index.json.gz`);
    return state.recipeRefs;
  }

  async function fetchGzipJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load viewer data (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser does not support gzip data. Please use a current browser.");
    }
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).json();
    } catch (error) {
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw error;
      }
    }
  }

  async function loadChunk(categoryIndex, recipeIndex) {
    const chunkIndex = Math.floor(recipeIndex / CHUNK_SIZE);
    const cacheKey = `${categoryIndex}/${chunkIndex}`;
    if (!state.chunks.has(cacheKey)) {
      const request = fetchGzipJson(`${VIEWER_ROOT}chunks/${categoryIndex}/${chunkIndex}.json.gz`)
        .catch((error) => {
          state.chunks.delete(cacheKey);
          throw error;
        });
      state.chunks.set(cacheKey, request);
    }
    const chunk = await state.chunks.get(cacheKey);
    return chunk[recipeIndex % CHUNK_SIZE];
  }

  async function recipeListFor(key) {
    const refs = await loadRecipeRefs();
    return Promise.all((refs[key] || []).map(async (ref) => ({
      ref,
      recipe: await loadChunk(ref[0], ref[1]),
      category: state.categoryByIndex[ref[0]]
    })));
  }

  function showPanel() {
    els.panel.classList.add("open");
    els.panel.setAttribute("aria-hidden", "false");
    document.body.classList.add("panel-open");
  }

  function closePanel() {
    els.panel.classList.remove("open");
    els.panel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("panel-open");
  }

  async function openItem(key) {
    state.selectedItem = key;
    const item = itemFor(key);
    const name = itemName(key);
    const mod = item ? modName(item[2]) : key.split("|")[0];
    const modLabel = item
      ? `<button class="detail-mod detail-mod-link" type="button" data-mod-search="${escapeHtml(item[2])}" aria-label="Show items from ${escapeHtml(mod)}">${escapeHtml(mod)}</button>`
      : `<span class="detail-mod">${escapeHtml(mod)}</span>`;
    els.details.innerHTML = `<div class="detail-hero">${itemIcon(key, "detail-icon")}<div class="detail-title"><h2>${escapeHtml(name)}</h2><p>${escapeHtml(itemId(key))}</p>${modLabel}</div>${favoriteButtonHtml(key, "favorite-toggle detail-favorite")}</div><div class="panel-subheading"><h3>Recipes</h3><span class="recipe-count">Loading…</span></div><div class="loading-inline">Loading recipes for this item…</div>`;
    showPanel();
    try {
      state.recipeImagesAvailable = await state.imageProbe;
      const recipes = await recipeListFor(key);
      if (state.selectedItem !== key) return;
      const heading = els.details.querySelector(".recipe-count");
      heading.textContent = `${recipes.length} found`;
      const loading = els.details.querySelector(".loading-inline");
      if (loading) loading.remove();
      if (!recipes.length) {
        els.details.insertAdjacentHTML("beforeend", `<p class="panel-empty">No exported recipes produce this item.</p>`);
        return;
      }
      for (let i = 0; i < recipes.length; i++) {
        els.details.insertAdjacentHTML("beforeend", recipeCardHtml(recipes[i], key, i));
      }
    } catch (error) {
      const loading = els.details.querySelector(".loading-inline");
      if (loading) loading.textContent = `Could not load recipes: ${error.message}`;
    }
  }

  function recipeIngredientsHtml(recipe) {
    const groups = recipe.in || [];
    if (!groups.length) return `<span class="panel-empty">No ingredient details in this export.</span>`;
    return groups.map((group) => {
      const choices = group || [];
      if (!choices.length) return "";
      return `<span class="ingredient-or">${choices.length > 1 ? "Choose one:" : "Ingredient"}</span><div class="recipe-ingredients">${choices.map(([key, amount]) =>
        `<button class="ingredient-chip recipe-item-link" type="button" data-item-key="${escapeHtml(key)}" aria-label="View ${escapeHtml(itemName(key))} details">${itemIcon(key)}<span>${escapeHtml(itemName(key))} ×${escapeHtml(amount)}</span></button>`
      ).join("")}</div>`;
    }).join("");
  }

  function recipeOutputsHtml(recipe) {
    const outputs = (recipe.out || []).flatMap((group) => group || []);
    if (!outputs.length) return "";
    return `<div class="recipe-output"><span aria-hidden="true">→</span><div class="recipe-ingredients">${outputs.map(([key, amount]) =>
      `<button class="ingredient-chip recipe-item-link" type="button" data-item-key="${escapeHtml(key)}" aria-label="View ${escapeHtml(itemName(key))} details">${itemIcon(key)}<span>${escapeHtml(itemName(key))} ×${escapeHtml(amount)}</span></button>`
    ).join("")}</div></div>`;
  }

  function recipeCardHtml(entry, targetKey, index) {
    const { recipe, category, ref } = entry;
    const imageSrc = state.recipeImagesAvailable && recipe.img && category ? `${EXPORT_ROOT}${category.dir}/${recipe.img}` : "";
    const craftingStation = category?.id === "minecraft:crafting"
      ? `<div class="crafting-station">${itemIcon("item|minecraft:crafting_table", "crafting-station-icon")}<span>Crafting Table</span></div>`
      : "";
    return `<article class="recipe-card"><div class="recipe-card-heading"><strong>${escapeHtml(category?.title || "Recipe")}</strong><span class="eyebrow">#${index + 1}</span></div>${imageSrc ? `<img class="recipe-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(category?.title || "Recipe diagram")}" loading="lazy" onerror="this.hidden=true">` : ""}<div>${recipeIngredientsHtml(recipe)}${recipeOutputsHtml(recipe)}</div>${craftingStation}<div class="recipe-card-footer"><button class="button primary build-tree" type="button" data-key="${escapeHtml(targetKey)}" data-category="${ref[0]}" data-recipe="${ref[1]}">Build tree</button></div></article>`;
  }

  function makeTreeNode(key, quantity, ref, ancestors, depth) {
    return { id: ++state.nodeSequence, key, quantity, ref: ref || state.recipeOverrides.get(key) || null, ancestors: new Set(ancestors), depth, children: null, recipe: null, refs: null, expanded: false, asResource: state.resourceKeys.has(key) };
  }

  async function loadNodeRecipe(node) {
    if (node.recipe) return node.recipe;
    if (!node.refs) {
      const refs = await loadRecipeRefs();
      node.refs = refs[node.key] || [];
    }
    if (!node.refs.length) return null;
    const preferredRef = state.recipeOverrides.get(node.key) || node.ref;
    if (!preferredRef || !node.refs.some(([category, index]) => category === preferredRef[0] && index === preferredRef[1])) {
      node.ref = node.refs[0];
    } else {
      node.ref = preferredRef;
    }
    node.recipe = await loadChunk(node.ref[0], node.ref[1]);
    return node.recipe;
  }

  function outputAmount(recipe, key) {
    for (const group of recipe.out || []) {
      const match = (group || []).find((entry) => entry[0] === key);
      if (match) return Number(match[1]) || 1;
    }
    return Number(recipe.out?.[0]?.[0]?.[1]) || 1;
  }

  async function expandNode(node, enforceLimit = false) {
    if (node.asResource) return [];
    if (node.expanded) return node.children || [];
    node.expanded = true;
    const recipe = await loadNodeRecipe(node);
    if (!recipe) {
      node.children = [];
      return node.children;
    }
    const crafts = Math.max(1, Math.ceil(Number(node.quantity) / outputAmount(recipe, node.key)));
    const ancestors = new Set(node.ancestors);
    ancestors.add(node.key);
    node.children = [];
    for (const group of recipe.in || []) {
      if (enforceLimit && state.treeNodes >= MAX_TREE_NODES) {
        state.treeTruncated = true;
        break;
      }
      const choices = group || [];
      if (!choices.length) continue;
      const [key, count] = choices[0];
      const quantity = (Number(count) || 1) * crafts;
      const child = makeTreeNode(key, quantity, null, ancestors, node.depth + 1);
      child.alternatives = choices;
      child.groupIndex = (recipe.in || []).indexOf(group);
      child.parent = node;
      node.children.push(child);
      state.treeNodes++;
    }
    return node.children;
  }

  async function buildTree(key, ref) {
    closePanel();
    state.recipeOverrides = new Map([[key, ref]]);
    state.tree = makeTreeNode(key, 1, ref, new Set(), 0);
    state.resourceKeys = new Set();
    state.tree.asResource = false;
    state.treeNodes = 1;
    state.nodeSequence = state.tree.id;
    state.treeTruncated = false;
    state.resources = [];
    state.resourcesComplete = false;
    $("#collapse-tree").disabled = false;
    $("#expand-tree").disabled = false;
    $("#export-resources").disabled = true;
    setView("tree");
    els.treeCaption.textContent = `Building an ingredient tree for ${itemName(key)}.`;
    try {
      await expandNode(state.tree);
      renderTree();
      updateResources();
    } catch (error) {
      els.treeCaption.textContent = `Could not build tree: ${error.message}`;
    }
  }

  function treeNodeHtml(node) {
    const loadedRefs = node.refs || state.recipeRefs?.[node.key] || [];
    const hasRecipes = loadedRefs.length > 0;
    const cyclic = node.ancestors.has(node.key);
    const canExpand = !node.asResource && !cyclic && node.depth < MAX_TREE_DEPTH && (hasRecipes || node.children !== null);
    const preferredRef = state.recipeOverrides.get(node.key) || node.ref;
    const recipeOptions = !node.asResource && loadedRefs.length > 1
      ? `<select class="tree-recipe-select" aria-label="Choose recipe for every ${escapeHtml(itemName(node.key))} occurrence in this tree" title="Applies to every ${escapeHtml(itemName(node.key))} occurrence in this tree">${loadedRefs.map((ref, index) => {
        const category = state.categoryByIndex[ref[0]];
        const selected = preferredRef && ref[0] === preferredRef[0] && ref[1] === preferredRef[1];
        return `<option value="${ref[0]}:${ref[1]}" ${selected ? "selected" : ""}>${escapeHtml(category?.title || "Recipe")} · ${index + 1}</option>`;
      }).join("")}</select>` : "";
    const alternativeOptions = !node.asResource && node.alternatives?.length > 1
      ? `<select class="tree-alt-select" aria-label="Choose ingredient">${node.alternatives.map(([key, amount]) =>
        `<option value="${escapeHtml(key)}" ${key === node.key ? "selected" : ""}>${escapeHtml(itemName(key))} ×${escapeHtml(amount)}</option>`
      ).join("")}</select>` : "";
    const icon = itemIcon(node.key, "tree-item-icon");
    const children = node.children || [];
    const childHtml = children.map((child) => treeNodeHtml(child)).join("");
    let note = "";
    if (node.asResource) note = `<div class="tree-note resource-note">Kept as a resource — recipe expansion skipped.</div>`;
    else if (cyclic) note = `<div class="tree-note cycle">Cycle detected — counted as a raw resource.</div>`;
    else if (node.depth >= MAX_TREE_DEPTH && hasRecipes) note = `<div class="tree-note">Depth limit reached; counted as a raw resource.</div>`;
    else if (node.expanded && !hasRecipes) note = `<div class="tree-note">No recipe exported — raw resource.</div>`;
    const resourceToggle = hasRecipes
      ? `<button class="tree-resource-toggle ${node.asResource ? "selected" : ""}" type="button" data-resource-node="${node.id}" aria-pressed="${node.asResource}" title="${node.asResource ? "Expand this item’s recipe throughout the tree" : "Count every occurrence as a resource without expanding its recipe"}">${node.asResource ? "Use recipe" : "Make resource"}</button>`
      : "";
    const quantityDisplay = node.depth === 0
      ? `<label class="tree-quantity tree-root-quantity">×<input class="tree-quantity-input" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(node.quantity)}" aria-label="Amount of ${escapeHtml(itemName(node.key))} to craft"></label>`
      : `<span class="tree-quantity">×${escapeHtml(node.quantity)}</span>`;
    return `<div class="tree-node" data-node-id="${node.id}"><div class="tree-row"><button class="tree-toggle" type="button" aria-label="${node.expanded ? "Collapse" : "Expand"} ${escapeHtml(itemName(node.key))}" ${canExpand ? "" : "disabled"}>${node.expanded ? "−" : "+"}</button>${icon}<span class="tree-item-name">${escapeHtml(itemName(node.key))}<small>${escapeHtml(itemId(node.key))}</small></span>${quantityDisplay}${alternativeOptions}${recipeOptions}${resourceToggle}</div>${note}${children.length ? `<div class="tree-children">${childHtml}</div>` : ""}</div>`;
  }

  function renderTree() {
    els.treeRoot.innerHTML = state.tree ? treeNodeHtml(state.tree) : "";
    if (state.treeTruncated) {
      els.treeCaption.textContent = `Automatic expansion reached ${MAX_TREE_NODES.toLocaleString()} nodes or depth ${MAX_TREE_DEPTH}; use the + buttons to inspect individual branches.`;
    } else {
      els.treeCaption.textContent = `Tree for ${itemName(state.tree.key)} · ${state.treeNodes.toLocaleString()} nodes`;
    }
  }

  function findTreeNode(parent, id) {
    if (parent.id === id) return parent;
    for (const child of parent.children || []) {
      const found = findTreeNode(child, id);
      if (found) return found;
    }
    return null;
  }

  function allNodes(root, results = []) {
    if (!root) return results;
    results.push(root);
    for (const child of root.children || []) allNodes(child, results);
    return results;
  }

  function recalculateTree(node) {
    if (!node || !node.children?.length) return;
    const crafts = Math.max(1, Math.ceil(Number(node.quantity) / outputAmount(node.recipe, node.key)));
    const recipeGroups = node.recipe?.in || [];
    node.children.forEach((child) => {
      const alternatives = recipeGroups[child.groupIndex] || [];
      const selected = alternatives.find(([key]) => key === child.key) || alternatives[0];
      if (!selected) return;
      if (child.key !== selected[0]) {
        child.ref = null;
        child.refs = null;
        child.recipe = null;
        child.children = null;
        child.expanded = false;
      }
      child.key = selected[0];
      child.quantity = (Number(selected[1]) || 1) * crafts;
      child.alternatives = alternatives;
      recalculateTree(child);
    });
  }

  async function selectNodeRecipe(node, ref) {
    state.recipeOverrides.set(node.key, ref);
    const matchingNodes = allNodes(state.tree).filter((entry) => entry.key === node.key);
    const expandedNodeIds = new Set(matchingNodes.filter((entry) => entry.expanded).map((entry) => entry.id));
    expandedNodeIds.add(node.id);
    for (const matchingNode of matchingNodes) {
      matchingNode.ref = ref;
      matchingNode.recipe = null;
      matchingNode.children = null;
      matchingNode.expanded = false;
    }
    state.treeNodes = allNodes(state.tree).length;
    for (const matchingNode of allNodes(state.tree).filter((entry) => entry.key === node.key)) {
      if (expandedNodeIds.has(matchingNode.id) && !matchingNode.asResource) {
        await expandNode(matchingNode, true);
      }
    }
    recalculateTree(state.tree);
    state.treeNodes = allNodes(state.tree).length;
    renderTree();
    updateResources();
  }

  async function expandAll() {
    if (!state.tree) return;
    els.expandTree.disabled = true;
    els.treeProgress.hidden = false;
    const queue = [state.tree];
    let processed = 0;
    try {
      while (queue.length) {
        const batch = queue.splice(0, 32);
        await Promise.all(batch.map(async (node) => {
          if (node.asResource || node.depth >= MAX_TREE_DEPTH || state.treeNodes >= MAX_TREE_NODES || node.ancestors.has(node.key)) {
            if (node.depth >= MAX_TREE_DEPTH || state.treeNodes >= MAX_TREE_NODES) state.treeTruncated = true;
            return;
          }
          const children = await expandNode(node, true);
          for (const child of children) {
            if (child.ancestors.has(child.key)) continue;
            if (child.depth < MAX_TREE_DEPTH && state.treeNodes < MAX_TREE_NODES) queue.push(child);
            else state.treeTruncated = true;
          }
          processed++;
        }));
        state.treeNodes = allNodes(state.tree).length;
        els.treeProgress.textContent = `Expanding recipe tree… ${processed.toLocaleString()} branches`;
      }
      recalculateTree(state.tree);
      renderTree();
      updateResources();
    } catch (error) {
      showNotice(`Tree expansion stopped: ${error.message}`, true);
    } finally {
      els.treeProgress.hidden = true;
      els.expandTree.disabled = false;
    }
  }

  function collapseAll() {
    for (const node of allNodes(state.tree)) {
      node.children = null;
      node.expanded = false;
    }
    if (state.tree) {
      state.tree.children = null;
      state.tree.expanded = false;
      state.treeNodes = 1;
    }
    state.treeTruncated = false;
    state.resources = [];
    renderTree();
    updateResources();
  }

  function updateResources() {
    if (!state.tree) return;
    const totals = new Map();
    for (const node of allNodes(state.tree)) {
      if (node === state.tree && !node.expanded && !node.asResource) continue;
      const hasRecipe = (node.refs || state.recipeRefs?.[node.key] || []).length > 0;
      const rawResource = node.ancestors.has(node.key) || node.depth >= MAX_TREE_DEPTH || !hasRecipe;
      const pendingRecipe = hasRecipe && !node.expanded && !node.asResource && !rawResource;
      if (!node.asResource && !rawResource && !pendingRecipe) continue;
      const entry = totals.get(node.key) || { amount: 0, pendingRecipe: false, markedResource: false };
      entry.amount += Number(node.quantity || 0);
      entry.pendingRecipe ||= pendingRecipe;
      entry.markedResource ||= node.asResource;
      totals.set(node.key, entry);
    }
    state.resources = [...totals.entries()]
      .map(([key, entry]) => [
        key,
        entry.amount,
        entry.pendingRecipe ? "Recipe not expanded" : entry.markedResource ? "Kept as resource" : "Raw resource"
      ])
      .sort((a, b) => itemName(a[0]).localeCompare(itemName(b[0])));
    state.resourcesComplete = allNodes(state.tree).every((node) =>
      node.asResource || node.ancestors.has(node.key) || node.depth >= MAX_TREE_DEPTH ||
      !(node.refs || state.recipeRefs?.[node.key] || []).length || node.expanded
    );
    els.exportResources.disabled = state.resources.length === 0;
  }

  function renderResources() {
    if (!state.resources.length) {
      els.resourceCaption.textContent = "Expand a recipe tree to calculate its raw ingredients.";
      els.resourceList.innerHTML = `<div class="empty-state compact"><span class="empty-symbol" aria-hidden="true">▤</span><strong>No totals yet</strong><span>Build a recipe tree to see the items you need, including recipes you have not expanded.</span></div>`;
      return;
    }
    const partial = state.resourcesComplete ? "" : " · partial, expand more branches";
    els.resourceCaption.textContent = `${state.resources.length.toLocaleString()} needed items for ${itemName(state.tree.key)}${partial}${state.treeTruncated ? " · tree is capped" : ""}`;
    els.resourceList.innerHTML = state.resources.map(([key, amount, status]) =>
      `<div class="resource-row">${itemIcon(key)}<div class="resource-name">${escapeHtml(itemName(key))}<div class="resource-id">${escapeHtml(itemId(key))} · ${escapeHtml(status)}</div></div><span class="resource-amount">×${escapeHtml(amount)}</span></div>`
    ).join("");
  }

  function exportResources() {
    if (!state.resources.length) return;
    const rows = [["Item", "ID", "Quantity", "Status"], ...state.resources.map(([key, amount, status]) => [itemName(key), itemId(key), amount, status])];
    const csv = rows.map((row) => row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "recipe-tree-resources.csv";
    document.body.append(link);
    link.click();
    const url = link.href;
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
    document.querySelector("[data-go-items]").addEventListener("click", () => setView("items"));
    els.search.addEventListener("input", () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => renderItems(true), 100);
    });
    els.modFilter.addEventListener("change", () => renderItems(true));
    els.grid.addEventListener("click", (event) => {
      const favoriteButton = event.target.closest("[data-favorite-key]");
      if (favoriteButton) {
        toggleFavorite(favoriteButton.dataset.favoriteKey);
        return;
      }
      const card = event.target.closest("[data-item-key]");
      if (card) openItem(card.dataset.itemKey);
    });
    els.loadMore.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderItems();
    });
    els.panel.addEventListener("click", (event) => {
      const modLink = event.target.closest("[data-mod-search]");
      if (modLink) {
        state.selectedItem = null;
        els.search.value = `@${modLink.dataset.modSearch}`;
        els.modFilter.value = modLink.dataset.modSearch;
        closePanel();
        setView("items");
        return;
      }
      const favoriteButton = event.target.closest("[data-favorite-key]");
      if (favoriteButton) {
        toggleFavorite(favoriteButton.dataset.favoriteKey);
        return;
      }
      const itemLink = event.target.closest("[data-item-key]");
      if (itemLink) {
        openItem(itemLink.dataset.itemKey);
        return;
      }
      if (event.target.closest("[data-close-panel]")) {
        closePanel();
        return;
      }
      const button = event.target.closest(".build-tree");
      if (button) buildTree(button.dataset.key, [Number(button.dataset.category), Number(button.dataset.recipe)]);
    });
    els.treeRoot.addEventListener("click", async (event) => {
      const resourceToggle = event.target.closest("[data-resource-node]");
      if (resourceToggle) {
        const node = findTreeNode(state.tree, Number(resourceToggle.dataset.resourceNode));
        if (!node) return;
        const asResource = !state.resourceKeys.has(node.key);
        if (asResource) state.resourceKeys.add(node.key);
        else state.resourceKeys.delete(node.key);
        for (const matchingNode of allNodes(state.tree).filter((entry) => entry.key === node.key)) {
          matchingNode.asResource = asResource;
          if (asResource) {
            matchingNode.expanded = false;
            matchingNode.children = null;
          }
        }
        state.treeNodes = allNodes(state.tree).length;
        renderTree();
        updateResources();
        return;
      }
      const toggle = event.target.closest(".tree-toggle");
      if (!toggle || toggle.disabled) return;
      const element = toggle.closest(".tree-node");
      const node = findTreeNode(state.tree, Number(element.dataset.nodeId));
      if (!node) return;
      try {
        if (node.expanded) {
          node.expanded = false;
          node.children = null;
        } else {
          await expandNode(node);
        }
        recalculateTree(state.tree);
        state.treeNodes = allNodes(state.tree).length;
        renderTree();
        updateResources();
      } catch (error) {
        showNotice(`Could not expand this recipe: ${error.message}`, true);
      }
    });
    els.treeRoot.addEventListener("change", async (event) => {
      const quantityInput = event.target.closest(".tree-quantity-input");
      if (quantityInput) {
        const quantity = Number(quantityInput.value);
        if (!Number.isSafeInteger(quantity) || quantity < 1) {
          showNotice("Enter a positive whole number for the main item.", true);
          renderTree();
          return;
        }
        state.tree.quantity = quantity;
        recalculateTree(state.tree);
        renderTree();
        updateResources();
        showNotice("");
        return;
      }
      const alternative = event.target.closest(".tree-alt-select");
      if (alternative) {
        const element = alternative.closest(".tree-node");
        const node = findTreeNode(state.tree, Number(element.dataset.nodeId));
        if (!node) return;
        node.key = alternative.value;
        node.ref = null;
        node.refs = null;
        node.recipe = null;
        node.children = null;
        node.expanded = false;
        node.asResource = state.resourceKeys.has(node.key);
        recalculateTree(state.tree);
        state.treeNodes = allNodes(state.tree).length;
        renderTree();
        updateResources();
        return;
      }
      const select = event.target.closest(".tree-recipe-select");
      if (!select) return;
      const element = select.closest(".tree-node");
      const node = findTreeNode(state.tree, Number(element.dataset.nodeId));
      if (!node) return;
      const [category, recipe] = select.value.split(":").map(Number);
      try {
        await selectNodeRecipe(node, [category, recipe]);
      } catch (error) {
        showNotice(`Could not switch recipe: ${error.message}`, true);
      }
    });
    els.expandTree.addEventListener("click", expandAll);
    els.collapseTree.addEventListener("click", collapseAll);
    els.exportResources.addEventListener("click", exportResources);
    els.settingsButton.addEventListener("click", () => {
      const opening = els.settingsMenu.hidden;
      els.settingsMenu.hidden = !opening;
      els.settingsButton.setAttribute("aria-expanded", String(opening));
    });
    $("#close-settings").addEventListener("click", () => {
      els.settingsMenu.hidden = true;
      els.settingsButton.setAttribute("aria-expanded", "false");
    });
    els.themeToggle.addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));
    $("#export-favorites").addEventListener("click", exportFavorites);
    $("#import-favorites").addEventListener("click", () => els.favoritesFile.click());
    els.favoritesFile.addEventListener("change", () => {
      if (els.favoritesFile.files?.[0]) importFavorites(els.favoritesFile.files[0]);
    });
    document.addEventListener("click", (event) => {
      if (els.settingsMenu.hidden || event.target.closest("#settings-menu, #settings-button")) return;
      els.settingsMenu.hidden = true;
      els.settingsButton.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        event.preventDefault();
        setView("items");
        els.search.focus();
      }
      if (event.key === "Escape") {
        closePanel();
        els.settingsMenu.hidden = true;
        els.settingsButton.setAttribute("aria-expanded", "false");
      }
    });
  }

  async function start() {
    bindEvents();
    try {
      state.catalog = await fetchGzipJson(`${VIEWER_ROOT}catalog.json.gz`);
      state.categoryByIndex = state.catalog.categories;
      state.items = state.catalog.items;
      state.itemByKey = new Map(state.items.map((item) => [item[0], item]));
      loadSavedPreferences();
      state.imageProbe = state.catalog.recipeImageProbe
        ? fetch(`${EXPORT_ROOT}${state.catalog.recipeImageProbe}`, { method: "HEAD" }).then((result) => result.ok).catch(() => false)
        : Promise.resolve(false);
      $("#pack-name").textContent = state.catalog.pack?.name || "JEI export";
      $("#pack-version").textContent = state.catalog.pack?.version || "";
      $("#minecraft-version").textContent = state.catalog.minecraft ? `Minecraft ${state.catalog.minecraft}` : "";
      $("#footer-counts").textContent = `${Number(state.catalog.counts?.items || state.items.length).toLocaleString()} items`;
      buildModFilter();
      els.search.disabled = false;
      els.search.focus({ preventScroll: true });
      els.resultsCount.textContent = `${state.items.length.toLocaleString()} items`;
      renderItems(true);
    } catch (error) {
      showNotice(`Unable to load the prepared JEI export. Run build_viewer.py from the project folder, then open this site through a local web server (for example: python -m http.server 8000). Details: ${error.message}`, true);
      els.resultsCount.textContent = "Export data is not ready";
    }
  }

  start();
})();
