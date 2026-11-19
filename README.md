# Local JEI Recipe Tree

A static, mobile-friendly recipe viewer for the JEI export in `jei-exports/jei-exports`. It does not accept uploads or offer a modpack picker: the pack name and version come from that export's manifest.

## Prepare the export

Run this once from the project folder with Python 3:

```powershell
python .\build_viewer.py
```

The script creates a compact catalog and small, lazy-loaded recipe chunks under `jei-exports/jei-exports/viewer`. It leaves the original JEI export files untouched. Run it again after replacing or updating the export.

## Run locally

Browsers do not allow this site to fetch its data directly from a `file://` URL. Start a local static server from the project folder:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish for phone access

Commit the site, generated `jei-exports/jei-exports/viewer` folder, and the `jei-exports/jei-exports/icons` folder. The included `.gitignore` excludes the original multi-gigabyte ZIP, large source JSON files, and optional recipe diagrams; those files remain available locally and the viewer uses diagrams when present. Without the diagrams, recipes still show ingredient/output icons and details. In GitHub, configure **Settings → Pages → Deploy from a branch**, select `main` and `/(root)`, then visit the published URL from your phone. GitHub Pages sites are publicly accessible even when their source repository is private; private published Pages sites require GitHub Enterprise Cloud for an organization. Do not publish pack data there if it must remain private.

The item catalog is searchable and filterable by mod, including JEI-style `@mod` searches. Favorite items with the star on a catalog card and find them in the Favorites tab. Favorites are stored as compact item IDs in the current browser; the Settings menu can export or import a small JSON file to move them between devices. The Settings menu also toggles dark and light themes.

Open an item to see its exported recipes; crafting recipes show the crafting-table icon. Favorite items from the catalog or their detail panel, and click recipe ingredients or outputs to open their item details. Click the mod name in an item's details to filter the catalog to that mod. Build and expand an ingredient tree, then change the root item's amount to recalculate ingredient quantities and resource totals (crafting counts round up to whole recipe outputs). If an item has multiple recipes, selecting one applies that recipe choice to every occurrence of the item in the current tree, including branches expanded later. Use **Make resource** on an ingredient to count every occurrence of that item in the current tree as a resource without expanding its recipe; the option can be reversed with **Use recipe**. Resources includes a hierarchical recipe breakdown; use **Show tree** to reveal ingredients beneath an item while keeping it visible as a parent. The separate collected resource totals and progress percentage avoid counting an item and its ingredients twice. Track gathered amounts with the per-item checkbox or number field; collected amounts are saved in this browser. Resource totals can be exported as CSV. The generated viewer data is gzip-compressed and loaded in small chunks as needed.
