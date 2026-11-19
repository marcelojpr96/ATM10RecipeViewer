# Local JEI Recipe Tree

A static, mobile-friendly recipe viewer for the JEI export in `jei-exports/jei-exports`. It does not accept uploads or offer a modpack picker: the pack name and version come from that export's manifest.

## Prepare the export

Run this once from the project folder with Python 3:

```powershell
python .\build_viewer.py
```

The script creates a compact catalog (including mob details), recipe indexes for both recipe outputs and ingredients, and small, lazy-loaded recipe chunks under `jei-exports/jei-exports/viewer`. It leaves the original JEI export files untouched. Run it again after replacing or updating the export.

## Run locally

Browsers do not allow this site to fetch its data directly from a `file://` URL. Start a local static server from the project folder:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish for phone access

Commit the site, generated `jei-exports/jei-exports/viewer` folder, and the `jei-exports/jei-exports/icons` and `jei-exports/jei-exports/mobs` asset folders. The viewer embeds mob metadata in its generated catalog and loads mob sprites from `mobs/`. The included `.gitignore` excludes the original multi-gigabyte ZIP, large source JSON files, and optional recipe diagrams; those files remain available locally and the viewer uses diagrams when present. Without the diagrams, recipes still show ingredient/output icons and details. In GitHub, configure **Settings → Pages → Deploy from a branch**, select `main` and `/(root)`, then visit the published URL from your phone. GitHub Pages sites are publicly accessible even when their source repository is private; private published Pages sites require GitHub Enterprise Cloud for an organization. Do not publish pack data there if it must remain private.

The landing page has full-screen, edge-to-edge item and mob image carousels, with the number of rows adapting to the viewport size and alternating directions. Use the top-left navigation menu to open Items, Mobs, or Settings. The item catalog is searchable and filterable by mod, including JEI-style `@mod` searches. Favorite items with the star on a catalog card and find them in the Favorites tab. Favorites are stored as compact item IDs in the current browser; Settings can export or import a small JSON file to move them between devices and toggle dark or light themes. The Mobs catalog can be searched and filtered by mod; mob details include health, size, category, and exported drops, which link to item details.

Open an item to see its exported recipes in the **Item** tab (recipes that produce it) or **Ingredient** tab (recipes that use it). Filter by recipe type with the dropdown; results are grouped by type, and each numbered recipe can be collapsed independently. Large result lists load in batches. **Build tree** is available for recipes that produce the item. Crafting recipes show the crafting-table icon. Favorite items from the catalog or their detail panel, and click recipe ingredients or outputs to open their item details. Click the mod name in an item's details to filter the catalog to that mod. Build and expand an ingredient tree, then change the root item's amount to recalculate ingredient quantities and resource totals (crafting counts round up to whole recipe outputs). If an item has multiple recipes, selecting one applies that recipe choice to every occurrence of the item in the current tree, including branches expanded later. Use **Make resource** on an ingredient to count every occurrence of that item in the current tree as a resource without expanding its recipe; the option can be reversed with **Use recipe**. Resources to gather mirrors the expanded recipe tree, so expanded items appear as parents with their required materials nested beneath them. **Hide breakdown** collapses the separate recipe-tree visualization without changing resources to gather. The main crafted item appears above its indented requirements and has its own collection control; collecting all required materials automatically marks the main item acquired when their quantities are sufficient. The main item and materials count toward progress. Track gathered amounts with the per-item checkbox or number field; collected amounts are saved in this browser. Resource totals can be exported as CSV. The generated viewer data is gzip-compressed and loaded in small chunks as needed.
