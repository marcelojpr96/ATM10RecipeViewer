(() => {
  "use strict";

  const EXPORT_ROOT = "./jei-exports/jei-exports/";
  const VIEWER_ROOT = `${EXPORT_ROOT}viewer/`;
  const PAGE_SIZE = 120;
  const DETAIL_RECIPE_PAGE_SIZE = 30;
  const INGREDIENT_INDEX_CACHE_SIZE = 3;
  const CHUNK_SIZE = 256;
  const MAX_TREE_DEPTH = 10;
  const MAX_TREE_NODES = 2500;
  const FAVORITES_STORAGE_KEY = "recipe-tree:favorites:v1";
  const THEME_STORAGE_KEY = "recipe-tree:theme:v1";
  const COLLECTED_RESOURCES_STORAGE_KEY = "recipe-tree:collected-resources:v1";
  const MAIN_ITEM_COLLECTED_PREFIX = "main:";
  const $ = (selector) => document.querySelector(selector);

  const state = {
    catalog: null,
    imageProbe: Promise.resolve(false),
    recipeImagesAvailable: false,
    items: [],
    mobs: [],
    itemByKey: new Map(),
    favorites: new Set(),
    collectedResources: new Map(),
    theme: "dark",
    recipeRefs: null,
    ingredientRefs: new Map(),
    detailRefs: [],
    detailRecipes: [],
    recipeMode: "item",
    collapsedRecipeCards: new Set(),
    detailLoading: false,
    detailLoadError: "",
    detailLoadSequence: 0,
    categoryByIndex: [],
    chunks: new Map(),
    selectedItem: null,
    selectedMob: null,
    page: "home",
    view: "items",
    visibleCount: PAGE_SIZE,
    visibleMobCount: PAGE_SIZE,
    tree: null,
    treeNodes: 0,
    nodeSequence: 0,
    recipeOverrides: new Map(),
    resourceKeys: new Set(),
    treeTruncated: false,
    resources: [],
    resourcesComplete: false,
    resourceTreeCollapsed: false,
    searchTimer: 0,
    mobSearchTimer: 0,
    homeResizeTimer: 0,
    homeLayoutKey: ""
  };

  const els = {
    notice: $("#app-notice"),
    navButton: $("#nav-button"),
    navMenu: $("#main-nav"),
    homeButton: $("#home-button"),
    sectionTabs: $("#section-tabs"),
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
    resourceTreeList: $("#resource-tree-list"),
    resourceList: $("#resource-list"),
    resourceBreakdownToggle: $("#resource-breakdown-toggle"),
    resourceCaption: $("#resource-caption"),
    resourceProgressPercent: $("#resource-progress-percent"),
    resourceProgressCount: $("#resource-progress-count"),
    resourceProgressBar: $("#resource-progress-bar"),
    resourceProgressFill: $("#resource-progress-fill"),
    exportResources: $("#export-resources"),
    catalogTitle: $("#catalog-title"),
    favoritesCount: $("#favorites-count"),
    mobSearch: $("#mob-search-input"),
    mobModFilter: $("#mob-mod-filter"),
    mobGrid: $("#mob-grid"),
    mobResultsCount: $("#mob-results-count"),
    mobLoadMore: $("#mob-load-more"),
    panelTitle: $("#panel-title"),
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

  function closeMainNav() {
    els.navMenu.hidden = true;
    els.navButton.setAttribute("aria-expanded", "false");
    els.navButton.setAttribute("aria-label", "Open navigation menu");
  }

  function openSettings() {
    closeMainNav();
    els.settingsMenu.hidden = false;
  }

  function setPage(page) {
    if (page === "settings") {
      openSettings();
      return;
    }
    if (state.page !== page) closePanel();
    state.page = page;
    document.querySelectorAll(".page-view").forEach((section) => {
      section.hidden = section.id !== `${page}-page`;
    });
    els.sectionTabs.hidden = page !== "items";
    closeMainNav();
    if (page === "items") {
      setView("items");
    } else if (page === "mobs") {
      renderMobs(true);
    } else if (page === "home") {
      renderHomeCarousels();
    }
  }

  function setView(view) {
    if (state.page !== "items") closePanel();
    state.page = "items";
    state.view = view;
    document.querySelectorAll(".page-view").forEach((section) => {
      section.hidden = section.id !== "items-page";
    });
    els.sectionTabs.hidden = false;
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
    try {
      const savedResources = localStorage.getItem(COLLECTED_RESOURCES_STORAGE_KEY);
      if (savedResources) {
        const savedEntries = JSON.parse(savedResources);
        if (!savedEntries || typeof savedEntries !== "object" || Array.isArray(savedEntries)) {
          throw new Error("Saved resource progress must be an item-to-amount map.");
        }
        const entries = Object.entries(savedEntries);
        if (entries.some(([, amount]) => !Number.isSafeInteger(amount) || amount < 0)) {
          throw new Error("Saved collected amounts must be non-negative whole numbers.");
        }
        state.collectedResources = new Map(entries.filter(([key, amount]) => {
          const itemKey = key.startsWith(MAIN_ITEM_COLLECTED_PREFIX)
            ? key.slice(MAIN_ITEM_COLLECTED_PREFIX.length)
            : key;
          return state.itemByKey.has(itemKey) && amount > 0;
        }));
      }
    } catch (error) {
      showNotice(`Could not load saved resource progress: ${error.message}`, true);
      state.collectedResources.clear();
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

  function mobSpriteHtml(mob, className = "") {
    const frames = Math.max(1, Math.floor(Number(mob.frames) || 1));
    const fps = Math.max(0.1, Number(mob.fps) || 1);
    const src = mob.icon ? `${EXPORT_ROOT}${mob.icon}` : "";
    if (!src) return `<span class="mob-sprite ${className} mob-sprite-fallback" aria-hidden="true">◇</span>`;
    return `<span class="mob-sprite ${className}" role="img" aria-label="${escapeHtml(mob.name)}" style="--sprite-image: url('${escapeHtml(src)}'); --sprite-frames: ${frames}; --sprite-width: ${frames * 100}%; --sprite-duration: ${frames / fps}s;"></span>`;
  }

  function buildMobModFilter() {
    const mods = [...new Set(state.mobs.map((mob) => mob.mod).filter(Boolean))]
      .sort((a, b) => modName(a).localeCompare(modName(b)));
    const fragment = document.createDocumentFragment();
    for (const mod of mods) {
      const option = document.createElement("option");
      option.value = mod;
      option.textContent = modName(mod);
      fragment.append(option);
    }
    els.mobModFilter.append(fragment);
    els.mobSearch.disabled = false;
    els.mobModFilter.disabled = false;
  }

  function renderMobs(reset = false) {
    if (!state.catalog) return;
    if (reset) state.visibleMobCount = PAGE_SIZE;
    const queryTerms = els.mobSearch.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const modTerms = queryTerms.filter((term) => term.startsWith("@")).map((term) => term.slice(1));
    const mobTerms = queryTerms.filter((term) => !term.startsWith("@"));
    const selectedMod = els.mobModFilter.value;
    const matches = state.mobs.filter((mob) => {
      if (selectedMod && mob.mod !== selectedMod) return false;
      const modText = `${mob.mod} ${modName(mob.mod)}`.toLocaleLowerCase();
      if (modTerms.some((term) => !modText.includes(term))) return false;
      const mobText = `${mob.name} ${mob.id} ${mob.category || ""} ${modName(mob.mod)}`.toLocaleLowerCase();
      return mobTerms.every((term) => mobText.includes(term));
    }).sort((a, b) => a.name.localeCompare(b.name));
    const shown = matches.slice(0, state.visibleMobCount);
    const fragment = document.createDocumentFragment();
    for (const mob of shown) {
      const card = document.createElement("article");
      card.className = "item-card";
      card.innerHTML = `<button class="item-card-open mob-card-open" type="button" data-mob-id="${escapeHtml(mob.id)}" aria-label="Open ${escapeHtml(mob.name)}, ${escapeHtml(modName(mob.mod))}">${mobSpriteHtml(mob, "mob-card-sprite")}<span class="item-card-name">${escapeHtml(mob.name)}</span><span class="item-card-mod">${escapeHtml(modName(mob.mod))}</span></button>`;
      fragment.append(card);
    }
    if (matches.length === 0) {
      els.mobGrid.innerHTML = `<div class="empty-state compact item-grid-empty"><span class="empty-symbol" aria-hidden="true">◇</span><strong>No matching mobs</strong><span>Try a different name, ID, or mod filter.</span></div>`;
    } else {
      els.mobGrid.replaceChildren(fragment);
    }
    els.mobResultsCount.textContent = queryTerms.length || selectedMod
      ? `${shown.length.toLocaleString()} of ${matches.length.toLocaleString()} matching mobs`
      : `${state.mobs.length.toLocaleString()} mobs · showing ${shown.length.toLocaleString()}`;
    els.mobLoadMore.hidden = shown.length >= matches.length;
    els.mobLoadMore.textContent = `Show ${Math.min(PAGE_SIZE, matches.length - shown.length).toLocaleString()} more mobs`;
  }

  function renderHomeCarousels() {
    if (!state.catalog) return;
    const itemCandidates = state.items.filter((item) => item[3]);
    const mobCandidates = state.mobs.filter((mob) => mob.icon);
    const width = document.documentElement.clientWidth || window.innerWidth;
    const height = document.documentElement.clientHeight || window.innerHeight;
    const mobileLayout = width <= 760;
    const minRows = mobileLayout ? 5 : height < 600 ? 3 : 5;
    const rowCount = Math.max(minRows, Math.min(12, Math.floor(Math.min(width / 200, height / 100))));
    const cardsPerRow = Math.max(14, Math.ceil(width / 78) + 2);
    const layoutKey = `${rowCount}:${cardsPerRow}`;
    if (state.homeLayoutKey === layoutKey) return;
    state.homeLayoutKey = layoutKey;
    const rows = document.createDocumentFragment();
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const row = document.createElement("div");
      row.className = "home-carousel-row";
      row.dataset.direction = rowIndex % 2 === 0 ? "left" : "right";
      const topOffset = mobileLayout ? 10 : 14;
      const topSpan = mobileLayout ? 80 : 72;
      row.style.setProperty("--row-top", `${topOffset + (rowIndex * topSpan) / (rowCount - 1)}%`);
      row.style.setProperty("--scroll-duration", `${Math.max(45, width / 20)}s`);
      const track = document.createElement("div");
      track.className = "home-carousel-track";
      const cards = [];
      for (let index = 0; index < cardsPerRow; index++) {
        if ((index + rowIndex) % 4 === 1 && mobCandidates.length) {
          const mob = mobCandidates[(rowIndex * 13 + index * 3) % mobCandidates.length];
          cards.push(`<span class="home-carousel-card" title="${escapeHtml(mob.name)}">${mobSpriteHtml(mob, "home-carousel-mob")}</span>`);
        } else if (itemCandidates.length) {
          const item = itemCandidates[(rowIndex * 19 + index * 7) % itemCandidates.length];
          cards.push(`<span class="home-carousel-card" title="${escapeHtml(item[1])}">${itemIcon(item[0], "home-carousel-item")}</span>`);
        }
      }
      const sequence = cards.join("");
      track.innerHTML = sequence + sequence;
      row.append(track);
      rows.append(row);
    }
    $("#home-carousels").replaceChildren(rows);
  }

  function openMob(mobId) {
    const mob = state.mobs.find((entry) => entry.id === mobId);
    if (!mob) return;
    closePanel();
    state.selectedMob = mob.id;
    els.panelTitle.textContent = "MOB DETAILS";
    els.panel.setAttribute("aria-label", "Mob details");
    const health = Number.isFinite(Number(mob.health)) ? `${Number(mob.health).toLocaleString()} HP` : "Unknown";
    const dimensions = Number.isFinite(Number(mob.width)) && Number.isFinite(Number(mob.height))
      ? `${Number(mob.width).toLocaleString(undefined, { maximumFractionDigits: 2 })} × ${Number(mob.height).toLocaleString(undefined, { maximumFractionDigits: 2 })} blocks`
      : "Unknown";
    const drops = mob.drops || [];
    const dropRows = drops.length
      ? drops.map((drop) => {
        const key = drop.k;
        const amount = drop.min === drop.max ? `${drop.min}` : `${drop.min ?? 1}–${drop.max ?? "?"}`;
        const chance = Number.isFinite(Number(drop.c)) ? ` · ${(Number(drop.c) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% chance` : "";
        const average = Number.isFinite(Number(drop.avg)) ? ` · ${Number(drop.avg).toLocaleString(undefined, { maximumFractionDigits: 2 })} avg.` : "";
        return `<button class="mob-drop-row" type="button" data-item-key="${escapeHtml(key)}">${itemIcon(key, "mob-drop-icon")}<span class="mob-drop-copy"><strong>${escapeHtml(itemName(key))}</strong><small>${escapeHtml(amount)} per drop${escapeHtml(chance)}${escapeHtml(average)}</small></span><span class="mob-drop-link" aria-hidden="true">↗</span></button>`;
      }).join("")
      : `<p class="panel-empty">No drops were included in this export.</p>`;
    els.details.innerHTML = `<div class="detail-hero mob-detail-hero">${mobSpriteHtml(mob, "detail-mob-sprite")}<div class="detail-title"><h2>${escapeHtml(mob.name)}</h2><p>${escapeHtml(mob.id)}</p><span class="detail-mod">${escapeHtml(modName(mob.mod))}</span></div></div><div class="mob-stats-grid"><div class="mob-stat"><span>Health</span><strong>${escapeHtml(health)}</strong></div><div class="mob-stat"><span>Size</span><strong>${escapeHtml(dimensions)}</strong></div><div class="mob-stat"><span>Category</span><strong>${escapeHtml(mob.category || "Unknown")}</strong></div></div><div class="panel-subheading"><h3>Drops</h3><span>${drops.length.toLocaleString()} listed</span></div><div class="mob-drop-list">${dropRows}</div>`;
    showPanel();
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

  function ingredientIndexShardFor(key) {
    let value = 0;
    for (let index = 0; index < key.length; index++) {
      value = (value * 31 + key.charCodeAt(index)) % 128;
    }
    return value.toString(16).padStart(2, "0");
  }

  async function loadIngredientRefs(key) {
    const shard = ingredientIndexShardFor(key);
    const cached = state.ingredientRefs.get(shard);
    if (cached) {
      state.ingredientRefs.delete(shard);
      state.ingredientRefs.set(shard, cached);
      return cached;
    }
    const request = fetchGzipJson(`${VIEWER_ROOT}ingredient-index/${shard}.json.gz`);
    const cachedRequest = request.catch((error) => {
      if (state.ingredientRefs.get(shard) === cachedRequest) state.ingredientRefs.delete(shard);
      throw error;
    });
    state.ingredientRefs.set(shard, cachedRequest);
    while (state.ingredientRefs.size > INGREDIENT_INDEX_CACHE_SIZE) {
      state.ingredientRefs.delete(state.ingredientRefs.keys().next().value);
    }
    return cachedRequest;
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

  async function recipeRefsFor(key, mode = "item") {
    const refs = mode === "ingredient" ? await loadIngredientRefs(key) : await loadRecipeRefs();
    return refs[key] || [];
  }

  async function recipeEntriesFor(refs) {
    return Promise.all(refs.map(async (ref) => {
      const recipe = await loadChunk(ref[0], ref[1]);
      if (!recipe) throw new Error("Recipe data is missing from its chunk.");
      return {
        ref,
        recipe,
        category: state.categoryByIndex[ref[0]]
      };
    }));
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
    state.selectedItem = null;
    state.selectedMob = null;
  }

  function updateRecipeModeTabs(mode) {
    els.details.querySelectorAll("[data-recipe-mode]").forEach((tab) => {
      const selected = tab.dataset.recipeMode === mode;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
  }

  function updateRecipeTypeFilter(refs) {
    const filter = els.details.querySelector(".recipe-type-filter");
    if (!filter) return;
    const categoryIndexes = [...new Set(refs.map((ref) => ref[0]))];
    filter.innerHTML = `<option value="">All types</option>${categoryIndexes.map((index) =>
      `<option value="${index}">${escapeHtml(state.categoryByIndex[index]?.title || "Recipe")}</option>`
    ).join("")}`;
    filter.disabled = categoryIndexes.length === 0;
  }

  function filteredRecipeRefs() {
    const filter = els.details.querySelector(".recipe-type-filter");
    const categoryIndex = filter?.value || "";
    return state.detailRefs.filter((ref) => categoryIndex === "" || String(ref[0]) === categoryIndex);
  }

  function renderItemRecipeResults() {
    const list = els.details.querySelector(".recipe-list");
    const count = els.details.querySelector(".recipe-count");
    if (!list || !count) return;
    const refs = filteredRecipeRefs();
    const total = refs.length;
    const loaded = state.detailRecipes.length;
    count.textContent = state.detailLoading && loaded === 0
      ? "Loading…"
      : loaded < total ? `Showing ${loaded} of ${total}` : `${total} found`;

    if (state.detailLoadError && loaded === 0) {
      list.innerHTML = `<p class="panel-empty">Could not load recipes: ${escapeHtml(state.detailLoadError)}</p>`;
      return;
    }
    if (total === 0 && !state.detailLoading) {
      const message = state.recipeMode === "item"
        ? "No exported recipes produce this item."
        : "No exported recipes use this item as an ingredient.";
      list.innerHTML = `<p class="panel-empty">${message}</p>`;
      return;
    }
    if (loaded === 0) {
      list.innerHTML = `<div class="loading-inline">Loading recipes…</div>`;
      return;
    }

    const groups = new Map();
    const typeNumbers = new Map();
    state.detailRecipes.forEach((entry) => {
      const categoryIndex = entry.ref[0];
      const recipeNumber = (typeNumbers.get(categoryIndex) || 0) + 1;
      typeNumbers.set(categoryIndex, recipeNumber);
      if (!groups.has(categoryIndex)) groups.set(categoryIndex, []);
      groups.get(categoryIndex).push({ entry, recipeNumber });
    });
    const groupHtml = [...groups].map(([categoryIndex, entries]) => {
      const category = state.categoryByIndex[categoryIndex];
      const typeCount = refs.filter((ref) => ref[0] === categoryIndex).length;
      const recipesHtml = entries.map(({ entry, recipeNumber }) =>
        recipeCardHtml(entry, state.selectedItem, recipeNumber, state.recipeMode === "item")
      ).join("");
      return `<section class="recipe-type-group"><h4 class="recipe-type-heading"><span>${escapeHtml(category?.title || "Recipe")}</span><span class="recipe-type-count">${typeCount}</span></h4><div class="recipe-type-recipes">${recipesHtml}</div></section>`;
    }).join("");
    const errorHtml = state.detailLoadError
      ? `<p class="panel-empty">Could not load additional recipes: ${escapeHtml(state.detailLoadError)}</p>`
      : "";
    const moreHtml = loaded < total
      ? `<div class="recipe-card-footer"><button class="button secondary recipe-load-more" type="button"${state.detailLoading ? " disabled" : ""}>${state.detailLoading ? "Loading…" : `Show more (${total - loaded} remaining)`}</button></div>`
      : "";
    list.innerHTML = `${groupHtml}${errorHtml}${moreHtml}`;
  }

  async function loadMoreItemRecipes(key, mode, requestId) {
    if (state.detailLoading || state.selectedItem !== key || state.recipeMode !== mode) return;
    const refs = filteredRecipeRefs();
    const nextRefs = refs.slice(state.detailRecipes.length, state.detailRecipes.length + DETAIL_RECIPE_PAGE_SIZE);
    if (!nextRefs.length) {
      renderItemRecipeResults();
      return;
    }
    state.detailLoading = true;
    state.detailLoadError = "";
    renderItemRecipeResults();
    try {
      const recipes = await recipeEntriesFor(nextRefs);
      if (state.selectedItem !== key || state.recipeMode !== mode || requestId !== state.detailLoadSequence) return;
      state.detailRecipes.push(...recipes);
    } catch (error) {
      if (state.selectedItem !== key || state.recipeMode !== mode || requestId !== state.detailLoadSequence) return;
      state.detailLoadError = error.message;
    } finally {
      if (state.selectedItem === key && state.recipeMode === mode && requestId === state.detailLoadSequence) {
        state.detailLoading = false;
        renderItemRecipeResults();
      }
    }
  }

  async function loadItemRecipes(key, mode) {
    const requestId = ++state.detailLoadSequence;
    state.recipeMode = mode;
    state.detailRefs = [];
    state.detailRecipes = [];
    state.detailLoadError = "";
    state.detailLoading = true;
    updateRecipeModeTabs(mode);
    updateRecipeTypeFilter([]);
    renderItemRecipeResults();
    try {
      state.recipeImagesAvailable = await state.imageProbe;
      const refs = await recipeRefsFor(key, mode);
      if (state.selectedItem !== key || state.recipeMode !== mode || requestId !== state.detailLoadSequence) return;
      state.detailRefs = refs;
      state.detailLoading = false;
      updateRecipeTypeFilter(refs);
      await loadMoreItemRecipes(key, mode, requestId);
    } catch (error) {
      if (state.selectedItem !== key || state.recipeMode !== mode || requestId !== state.detailLoadSequence) return;
      state.detailLoading = false;
      state.detailLoadError = error.message;
      renderItemRecipeResults();
    }
  }

  async function openItem(key) {
    if (state.page !== "items") setPage("items");
    state.selectedMob = null;
    state.selectedItem = key;
    els.panelTitle.textContent = "ITEM DETAILS";
    els.panel.setAttribute("aria-label", "Item details");
    const item = itemFor(key);
    const name = itemName(key);
    const mod = item ? modName(item[2]) : key.split("|")[0];
    const modLabel = item
      ? `<button class="detail-mod detail-mod-link" type="button" data-mod-search="${escapeHtml(item[2])}" aria-label="Show items from ${escapeHtml(mod)}">${escapeHtml(mod)}</button>`
      : `<span class="detail-mod">${escapeHtml(mod)}</span>`;
    els.details.innerHTML = `<div class="detail-hero">${itemIcon(key, "detail-icon")}<div class="detail-title"><h2>${escapeHtml(name)}</h2><p>${escapeHtml(itemId(key))}</p>${modLabel}</div>${favoriteButtonHtml(key, "favorite-toggle detail-favorite")}</div><div class="panel-subheading recipe-panel-heading"><h3>Recipes</h3><span class="recipe-count">Loading…</span><label class="recipe-type-control"><span>Type</span><select class="recipe-type-filter" aria-label="Filter recipes by type" disabled><option value="">All types</option></select></label></div><div class="recipe-mode-tabs" role="tablist" aria-label="Recipe relationship"><button class="recipe-mode-tab active" type="button" role="tab" aria-selected="true" data-recipe-mode="item">Item</button><button class="recipe-mode-tab" type="button" role="tab" aria-selected="false" data-recipe-mode="ingredient">Ingredient</button></div><div class="recipe-list" role="tabpanel"></div>`;
    showPanel();
    loadItemRecipes(key, "item");
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

  function recipeCardHtml(entry, targetKey, recipeNumber, canBuildTree) {
    const { recipe, category, ref } = entry;
    const imageSrc = state.recipeImagesAvailable && recipe.img && category ? `${EXPORT_ROOT}${category.dir}/${recipe.img}` : "";
    const craftingStation = category?.id === "minecraft:crafting"
      ? `<div class="crafting-station">${itemIcon("item|minecraft:crafting_table", "crafting-station-icon")}<span>Crafting Table</span></div>`
      : "";
    const treeButton = canBuildTree
      ? `<div class="recipe-card-footer"><button class="button primary build-tree" type="button" data-key="${escapeHtml(targetKey)}" data-category="${ref[0]}" data-recipe="${ref[1]}">Build tree</button></div>`
      : "";
    const cardKey = `${state.selectedItem}|${state.recipeMode}|${ref[0]}|${ref[1]}`;
    const collapsed = state.collapsedRecipeCards.has(cardKey);
    return `<details class="recipe-card" data-recipe-card-key="${escapeHtml(cardKey)}"${collapsed ? "" : " open"}><summary class="recipe-card-heading"><strong>Recipe #${recipeNumber}</strong></summary><div class="recipe-card-content">${imageSrc ? `<img class="recipe-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(category?.title || "Recipe diagram")}" loading="lazy" onerror="this.hidden=true">` : ""}<div>${recipeIngredientsHtml(recipe)}${recipeOutputsHtml(recipe)}</div>${craftingStation}${treeButton}</div></details>`;
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
    state.resourceTreeCollapsed = false;
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
    const mainItemKey = state.tree.key;
    const mainItem = [
      mainItemKey,
      Math.max(1, Number(state.tree.quantity) || 1),
      "Main item",
      `${MAIN_ITEM_COLLECTED_PREFIX}${mainItemKey}`
    ];
    const requiredItems = [...totals.entries()]
      .map(([key, entry]) => [
        key,
        entry.amount,
        entry.pendingRecipe ? "Recipe not expanded" : entry.markedResource ? "Kept as resource" : "Raw resource",
        key
      ])
      .sort((a, b) => itemName(a[0]).localeCompare(itemName(b[0])));
    state.resources = [mainItem, ...requiredItems];
    state.resourcesComplete = allNodes(state.tree).every((node) =>
      node.asResource || node.ancestors.has(node.key) || node.depth >= MAX_TREE_DEPTH ||
      !(node.refs || state.recipeRefs?.[node.key] || []).length || node.expanded
    );
    els.exportResources.disabled = state.resources.length === 0;
    updateResourceProgress();
  }

  function updateResourceProgress() {
    let totalNeeded = 0;
    let totalCollected = 0;
    for (const [key, amount, , trackingKey = key] of state.resources) {
      const needed = Math.max(0, Number(amount) || 0);
      const collected = Math.min(needed, Math.max(0, Number(state.collectedResources.get(trackingKey)) || 0));
      totalNeeded += needed;
      totalCollected += collected;
    }
    const percent = totalNeeded ? Math.round((totalCollected / totalNeeded) * 100) : 0;
    els.resourceProgressPercent.textContent = `${percent}%`;
    els.resourceProgressCount.textContent = totalNeeded
      ? `${totalCollected.toLocaleString()} of ${totalNeeded.toLocaleString()} items collected`
      : "Build a recipe tree to start tracking resources.";
    els.resourceProgressBar.setAttribute("aria-valuenow", String(percent));
    els.resourceProgressBar.setAttribute("aria-valuetext", `${percent}% collected`);
    els.resourceProgressFill.style.width = `${percent}%`;
  }

  function requiredResourcesCollected() {
    return state.resources
      .filter(([, , status]) => status !== "Main item")
      .every(([key, amount, , trackingKey = key]) => {
        const collected = Math.max(0, Number(state.collectedResources.get(trackingKey)) || 0);
        return collected >= Math.max(0, Number(amount) || 0);
      });
  }

  function setCollectedAmount(key, amount) {
    const previous = state.collectedResources.get(key);
    if (amount > 0) state.collectedResources.set(key, amount);
    else state.collectedResources.delete(key);
    let autoMainKey = null;
    let previousAutoMain;
    const mainItem = state.resources.find(([, , status]) => status === "Main item");
    if (mainItem && key !== mainItem[3] && requiredResourcesCollected()) {
      autoMainKey = mainItem[3];
      previousAutoMain = state.collectedResources.get(autoMainKey);
      if ((Number(previousAutoMain) || 0) < Number(mainItem[1])) {
        state.collectedResources.set(autoMainKey, Number(mainItem[1]));
      } else {
        autoMainKey = null;
      }
    }
    try {
      localStorage.setItem(COLLECTED_RESOURCES_STORAGE_KEY, JSON.stringify(Object.fromEntries(state.collectedResources)));
    } catch (error) {
      if (previous === undefined) state.collectedResources.delete(key);
      else state.collectedResources.set(key, previous);
      if (autoMainKey) {
        if (previousAutoMain === undefined) state.collectedResources.delete(autoMainKey);
        else state.collectedResources.set(autoMainKey, previousAutoMain);
      }
      showNotice(`Could not save collected resources in this browser: ${error.message}`, true);
      renderResources();
      return;
    }
    showNotice("");
    renderResources();
  }

  function resourceTreeNodeHtml(node) {
    const loadedRefs = node.refs || state.recipeRefs?.[node.key] || [];
    const hasRecipes = loadedRefs.length > 0;
    const cyclic = node.ancestors.has(node.key);
    const canToggleTree = node.expanded || (!node.asResource && !cyclic && node.depth < MAX_TREE_DEPTH && hasRecipes);
    const preferredRef = state.recipeOverrides.get(node.key) || node.ref;
    const recipeRef = preferredRef && loadedRefs.some(([category, index]) => category === preferredRef[0] && index === preferredRef[1])
      ? preferredRef
      : loadedRefs[0];
    const recipeTitle = recipeRef ? state.categoryByIndex[recipeRef[0]]?.title : "";
    const showTreeControl = hasRecipes && !node.asResource
      ? `<label class="resource-tree-control"><input type="checkbox" data-show-tree-node="${node.id}" aria-label="Show recipe ingredients for ${escapeHtml(itemName(node.key))}" ${node.expanded ? "checked" : ""} ${canToggleTree ? "" : "disabled"}>Show tree</label>`
      : "";
    const children = node.children || [];
    const childHtml = node.expanded && children.length
      ? `<div class="resource-tree-children">${children.map((child) => resourceTreeNodeHtml(child)).join("")}</div>`
      : "";
    let note = "";
    if (node.asResource) note = `<div class="resource-tree-note">Kept as a resource; recipe expansion is skipped.</div>`;
    else if (cyclic) note = `<div class="resource-tree-note">Cycle detected; counted as a raw resource.</div>`;
    else if (node.depth >= MAX_TREE_DEPTH && hasRecipes) note = `<div class="resource-tree-note">Depth limit reached.</div>`;
    return `<div class="resource-tree-node" data-resource-node-id="${node.id}"><div class="resource-tree-row">${itemIcon(node.key, "resource-tree-icon")}<div class="resource-tree-item">${escapeHtml(itemName(node.key))}<small>${escapeHtml(itemId(node.key))}${recipeTitle ? ` · ${escapeHtml(recipeTitle)}` : ""}</small></div><span class="resource-tree-quantity">×${escapeHtml(node.quantity)}</span>${showTreeControl}</div>${note}${childHtml}</div>`;
  }

  function renderResourceTree() {
    els.resourceTreeList.innerHTML = state.tree
      ? resourceTreeNodeHtml(state.tree)
      : `<div class="empty-state compact"><strong>No recipe tree yet</strong><span>Build a recipe tree to browse item requirements by recipe.</span></div>`;
  }

  function resourceRowHtml(resource, extraClass = "") {
    const [key, amount, status, trackingKey = key] = resource;
    const needed = Math.max(0, Number(amount) || 0);
    const collected = Math.min(needed, Math.max(0, Number(state.collectedResources.get(trackingKey)) || 0));
    const complete = collected >= needed;
    return `<div class="resource-row ${extraClass} ${complete ? "is-complete" : ""}"><input class="resource-check" type="checkbox" data-resource-check="${escapeHtml(trackingKey)}" aria-label="Mark ${escapeHtml(itemName(key))} fully acquired" ${complete ? "checked" : ""}>${itemIcon(key)}<div class="resource-name">${escapeHtml(itemName(key))}<div class="resource-id">${escapeHtml(itemId(key))} · ${escapeHtml(status)}</div></div><label class="resource-collected"><span class="sr-only">Collected amount of ${escapeHtml(itemName(key))}</span><input class="resource-collected-input" type="number" min="0" max="${escapeHtml(needed)}" step="1" value="${escapeHtml(collected)}" data-collected-key="${escapeHtml(trackingKey)}" aria-label="Collected ${escapeHtml(itemName(key))}; ${escapeHtml(needed)} needed"><span aria-hidden="true">/ ${escapeHtml(needed)}</span></label></div>`;
  }

  function resourcePlanReferenceHtml(node) {
    return `<div class="resource-plan-reference">${itemIcon(node.key, "resource-tree-icon")}<div class="resource-plan-branch-name">${escapeHtml(itemName(node.key))}<small>${escapeHtml(itemId(node.key))} · Included in total above</small></div><span class="resource-tree-quantity">×${escapeHtml(node.quantity)}</span></div>`;
  }

  function resourcePlanNodeHtml(node, mainItem, resourcesByKey, renderedResources) {
    if (node === state.tree) {
      const children = node.expanded ? (node.children || []).map((child) =>
        resourcePlanNodeHtml(child, mainItem, resourcesByKey, renderedResources)
      ).join("") : "";
      return `<div class="resource-plan-node">${resourceRowHtml(mainItem, "resource-main-item")}${children ? `<div class="resource-plan-children" aria-label="Items needed for ${escapeHtml(itemName(node.key))}">${children}</div>` : ""}</div>`;
    }

    if (node.expanded) {
      const children = (node.children || []).map((child) =>
        resourcePlanNodeHtml(child, mainItem, resourcesByKey, renderedResources)
      ).join("");
      const recipeTitle = node.ref ? state.categoryByIndex[node.ref[0]]?.title : "";
      const emptyNote = children ? "" : `<div class="resource-plan-note">No ingredient details in this recipe.</div>`;
      return `<div class="resource-plan-node"><div class="resource-plan-branch-row">${itemIcon(node.key, "resource-tree-icon")}<div class="resource-plan-branch-name">${escapeHtml(itemName(node.key))}<small>${escapeHtml(itemId(node.key))}${recipeTitle ? ` · ${escapeHtml(recipeTitle)}` : " · Recipe expanded"}</small></div><span class="resource-tree-quantity">×${escapeHtml(node.quantity)}</span></div>${children ? `<div class="resource-plan-children" aria-label="Items needed for ${escapeHtml(itemName(node.key))}">${children}</div>` : emptyNote}</div>`;
    }

    const resource = resourcesByKey.get(node.key);
    if (!resource) return "";
    if (renderedResources.has(node.key)) return resourcePlanReferenceHtml(node);
    renderedResources.add(node.key);
    return resourceRowHtml(resource, "resource-needed-item");
  }

  function renderResources() {
    updateResourceProgress();
    renderResourceTree();
    els.resourceTreeList.hidden = state.resourceTreeCollapsed;
    els.resourceBreakdownToggle.textContent = state.resourceTreeCollapsed ? "Show breakdown" : "Hide breakdown";
    els.resourceBreakdownToggle.setAttribute("aria-expanded", String(!state.resourceTreeCollapsed));
    if (!state.resources.length) {
      els.resourceCaption.textContent = "Expand a recipe tree to calculate its raw ingredients.";
      els.resourceList.innerHTML = `<div class="empty-state compact"><span class="empty-symbol" aria-hidden="true">▤</span><strong>No totals yet</strong><span>Build a recipe tree to see the items you need, including recipes you have not expanded.</span></div>`;
      return;
    }
    const partial = state.resourcesComplete ? "" : " · partial, expand more branches";
    const itemCount = state.resources.length;
    const itemLabel = itemCount === 1 ? "tracked item type" : "tracked item types";
    els.resourceCaption.textContent = `${itemCount.toLocaleString()} ${itemLabel} for ${itemName(state.tree.key)}${partial}${state.treeTruncated ? " · tree is capped" : ""}`;
    const mainItem = state.resources.find(([, , status]) => status === "Main item");
    const requiredItems = state.resources.filter(([, , status]) => status !== "Main item");
    const resourcesByKey = new Map(requiredItems.map((resource) => [resource[0], resource]));
    const renderedResources = new Set();
    els.resourceList.innerHTML = `<div class="resource-plan">${resourcePlanNodeHtml(state.tree, mainItem, resourcesByKey, renderedResources)}</div>`;
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
    const refreshHomeCarousels = () => {
      if (state.page !== "home") return;
      window.clearTimeout(state.homeResizeTimer);
      state.homeResizeTimer = window.setTimeout(renderHomeCarousels, 150);
    };
    window.addEventListener("resize", refreshHomeCarousels);
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(refreshHomeCarousels).observe(document.documentElement);
    }
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
    document.querySelector("[data-go-items]").addEventListener("click", () => setPage("items"));
    els.homeButton.addEventListener("click", () => setPage("home"));
    els.navButton.addEventListener("click", () => {
      els.settingsMenu.hidden = true;
      const opening = els.navMenu.hidden;
      els.navMenu.hidden = !opening;
      els.navButton.setAttribute("aria-expanded", String(opening));
      els.navButton.setAttribute("aria-label", `${opening ? "Close" : "Open"} navigation menu`);
    });
    els.navMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (button) setPage(button.dataset.page);
    });
    document.querySelectorAll("#home-page [data-page]").forEach((button) => {
      button.addEventListener("click", () => setPage(button.dataset.page));
    });
    els.search.addEventListener("input", () => {
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => renderItems(true), 100);
    });
    els.modFilter.addEventListener("change", () => renderItems(true));
    els.mobSearch.addEventListener("input", () => {
      window.clearTimeout(state.mobSearchTimer);
      state.mobSearchTimer = window.setTimeout(() => renderMobs(true), 100);
    });
    els.mobModFilter.addEventListener("change", () => renderMobs(true));
    els.mobGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-mob-id]");
      if (card) openMob(card.dataset.mobId);
    });
    els.mobLoadMore.addEventListener("click", () => {
      state.visibleMobCount += PAGE_SIZE;
      renderMobs();
    });
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
      const recipeTab = event.target.closest("[data-recipe-mode]");
      if (recipeTab) {
        const mode = recipeTab.dataset.recipeMode;
        if (state.selectedItem && mode !== state.recipeMode) loadItemRecipes(state.selectedItem, mode);
        return;
      }
      if (event.target.closest(".recipe-load-more")) {
        loadMoreItemRecipes(state.selectedItem, state.recipeMode, state.detailLoadSequence);
        return;
      }
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
    els.panel.addEventListener("change", (event) => {
      if (!event.target.matches(".recipe-type-filter") || !state.selectedItem) return;
      state.detailRecipes = [];
      state.detailLoadError = "";
      state.detailLoading = false;
      const requestId = ++state.detailLoadSequence;
      loadMoreItemRecipes(state.selectedItem, state.recipeMode, requestId);
    });
    els.panel.addEventListener("toggle", (event) => {
      const card = event.target.closest(".recipe-card");
      if (!card || !state.selectedItem) return;
      const cardKey = card.dataset.recipeCardKey;
      if (card.open) state.collapsedRecipeCards.delete(cardKey);
      else state.collapsedRecipeCards.add(cardKey);
    }, true);
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
    els.resourceTreeList.addEventListener("change", async (event) => {
      const checkbox = event.target.closest("[data-show-tree-node]");
      if (!checkbox) return;
      const node = findTreeNode(state.tree, Number(checkbox.dataset.showTreeNode));
      if (!node) return;
      const wasExpanded = node.expanded;
      try {
        if (checkbox.checked) await expandNode(node, true);
        else {
          node.expanded = false;
          node.children = null;
        }
        recalculateTree(state.tree);
        state.treeNodes = allNodes(state.tree).length;
        renderTree();
        updateResources();
        renderResources();
        showNotice("");
      } catch (error) {
        node.expanded = wasExpanded;
        if (!wasExpanded) node.children = null;
        showNotice(`Could not update recipe breakdown: ${error.message}`, true);
        renderResources();
      }
    });
    els.resourceList.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-resource-check]");
      const input = event.target.closest("[data-collected-key]");
      if (!checkbox && !input) return;
      const key = checkbox ? checkbox.dataset.resourceCheck : input.dataset.collectedKey;
      const resource = state.resources.find(([, , , trackingKey]) => trackingKey === key);
      if (!resource) return;
      const needed = Number(resource[1]);
      const amount = checkbox ? (checkbox.checked ? needed : 0) : Number(input.value);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > needed) {
        showNotice(`Enter a whole number from 0 to ${needed} for ${itemName(resource[0])}.`, true);
        renderResources();
        return;
      }
      setCollectedAmount(key, amount);
    });
    els.resourceBreakdownToggle.addEventListener("click", () => {
      state.resourceTreeCollapsed = !state.resourceTreeCollapsed;
      renderResources();
    });
    els.expandTree.addEventListener("click", expandAll);
    els.collapseTree.addEventListener("click", collapseAll);
    els.exportResources.addEventListener("click", exportResources);
    $("#close-settings").addEventListener("click", () => {
      els.settingsMenu.hidden = true;
    });
    els.themeToggle.addEventListener("click", () => applyTheme(state.theme === "dark" ? "light" : "dark"));
    $("#export-favorites").addEventListener("click", exportFavorites);
    $("#import-favorites").addEventListener("click", () => els.favoritesFile.click());
    els.favoritesFile.addEventListener("change", () => {
      if (els.favoritesFile.files?.[0]) importFavorites(els.favoritesFile.files[0]);
    });
    document.addEventListener("click", (event) => {
      if (!els.settingsMenu.hidden && !event.target.closest("#settings-menu, #main-nav")) {
        els.settingsMenu.hidden = true;
      }
      if (!els.navMenu.hidden && !event.target.closest("#main-nav, #nav-button")) closeMainNav();
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
        closeMainNav();
      }
    });
  }

  async function start() {
    bindEvents();
    try {
      state.catalog = await fetchGzipJson(`${VIEWER_ROOT}catalog.json.gz?v=2`);
      state.categoryByIndex = state.catalog.categories;
      state.items = state.catalog.items;
      state.mobs = state.catalog.mobs || [];
      state.itemByKey = new Map(state.items.map((item) => [item[0], item]));
      loadSavedPreferences();
      state.imageProbe = state.catalog.recipeImageProbe
        ? fetch(`${EXPORT_ROOT}${state.catalog.recipeImageProbe}`, { method: "HEAD" }).then((result) => result.ok).catch(() => false)
        : Promise.resolve(false);
      $("#pack-name").textContent = state.catalog.pack?.name || "JEI export";
      $("#pack-version").textContent = state.catalog.pack?.version || "";
      $("#minecraft-version").textContent = state.catalog.minecraft ? `Minecraft ${state.catalog.minecraft}` : "";
      $("#footer-counts").textContent = `${Number(state.catalog.counts?.items || state.items.length).toLocaleString()} items · ${state.mobs.length.toLocaleString()} mobs`;
      buildModFilter();
      buildMobModFilter();
      els.search.disabled = false;
      els.resultsCount.textContent = `${state.items.length.toLocaleString()} items`;
      renderItems(true);
      renderMobs(true);
      setPage("home");
    } catch (error) {
      showNotice(`Unable to load the prepared JEI export. Run build_viewer.py from the project folder, then open this site through a local web server (for example: python -m http.server 8000). Details: ${error.message}`, true);
      els.resultsCount.textContent = "Export data is not ready";
      els.mobResultsCount.textContent = "Mob data is not ready";
    }
  }

  start();
})();
