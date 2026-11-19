#!/usr/bin/env python3
"""Prepare a compact, chunked static catalog from the JEI export."""

import gzip
import json
import os
import sys

BASE = os.path.join("jei-exports", "jei-exports")
OUTPUT = os.path.join(BASE, "viewer")
CHUNK_SIZE = 256
READ_SIZE = 1024 * 1024


def ingredient_index_shard(key):
    value = 0
    for character in key:
        value = (value * 31 + ord(character)) % 128
    return f"{value:02x}"


def json_array(path):
    decoder = json.JSONDecoder()
    with open(path, "r", encoding="utf-8") as source:
        buffer = source.read(READ_SIZE)
        position = 0
        eof = False

        def fill():
            nonlocal buffer, position, eof
            if eof:
                return
            if position:
                buffer = buffer[position:]
                position = 0
            more = source.read(READ_SIZE)
            if more:
                buffer += more
            else:
                eof = True

        while True:
            while position >= len(buffer) and not eof:
                fill()
            while position < len(buffer) and buffer[position].isspace():
                position += 1
            if position >= len(buffer):
                raise ValueError(f"{path}: expected a JSON array")
            if buffer[position] != "[":
                raise ValueError(f"{path}: expected '['")
            position += 1
            break

        while True:
            while True:
                while position < len(buffer) and (buffer[position].isspace() or buffer[position] == ","):
                    position += 1
                if position < len(buffer):
                    break
                if eof:
                    raise ValueError(f"{path}: unexpected end of JSON array")
                fill()
            if buffer[position] == "]":
                return
            try:
                item, end = decoder.raw_decode(buffer, position)
            except json.JSONDecodeError:
                if eof:
                    raise
                fill()
                continue
            position = end
            yield item


def write_gzip_json(path, value):
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if os.path.isfile(path):
        with gzip.open(path, "rb") as source:
            if source.read() == payload:
                return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as destination:
        destination.write(gzip.compress(payload, compresslevel=6, mtime=0))


def find_recipe_image_probe(categories):
    for category in categories:
        directory = os.path.join(BASE, category["dir"])
        if not os.path.isdir(directory):
            continue
        for filename in os.listdir(directory):
            if filename.startswith("r") and filename.endswith(".png"):
                return f'{category["dir"]}/{filename}'
    return ""


def main():
    required = [
        os.path.join(BASE, "manifest.json"),
        os.path.join(BASE, "items.json"),
        os.path.join(BASE, "mobs.json"),
        os.path.join(BASE, "index.json"),
        os.path.join(BASE, "categories.json"),
    ]
    missing = [path for path in required if not os.path.isfile(path)]
    if missing:
        print("Missing JEI export files: " + ", ".join(missing), file=sys.stderr)
        return 1

    with open(os.path.join(BASE, "manifest.json"), encoding="utf-8") as source:
        manifest = json.load(source)
    with open(os.path.join(BASE, "categories.json"), encoding="utf-8") as source:
        source_categories = json.load(source)["categories"]
    categories = [
        {key: category.get(key) for key in ("id", "title", "dir", "count", "icon")}
        for category in source_categories
    ]

    item_rows = []
    with open(os.path.join(BASE, "items.json"), encoding="utf-8") as source:
        for item in json.load(source)["items"]:
            item_rows.append([
                item["k"],
                item.get("n") or item["id"],
                item.get("m") or item["k"].split("|")[-1].split(":")[0],
                item.get("icon") or "",
            ])

    with open(os.path.join(BASE, "mobs.json"), encoding="utf-8") as source:
        mob_rows = [
            {
                "id": mob["id"],
                "name": mob.get("n") or mob["id"],
                "mod": mob.get("m") or "",
                "icon": mob.get("icon") or "",
                "frames": mob.get("frames") or 1,
                "fps": mob.get("fps") or 1,
                "width": mob.get("w"),
                "height": mob.get("h"),
                "health": mob.get("hp"),
                "category": mob.get("cat") or "",
                "drops": mob.get("drops") or [],
            }
            for mob in json.load(source)["mobs"]
        ]

    with open(os.path.join(BASE, "index.json"), encoding="utf-8") as source:
        source_index = json.load(source)
    recipe_refs = {
        key: entry["p"]
        for key, entry in source_index.items()
        if entry.get("p")
    }
    del source_index

    os.makedirs(OUTPUT, exist_ok=True)
    legacy_ingredient_index = os.path.join(OUTPUT, "ingredient-index.json.gz")
    if os.path.isfile(legacy_ingredient_index):
        os.remove(legacy_ingredient_index)
    ingredient_index_root = os.path.join(OUTPUT, "ingredient-index")
    if os.path.isdir(ingredient_index_root):
        for filename in os.listdir(ingredient_index_root):
            if filename.endswith(".json.gz"):
                os.remove(os.path.join(ingredient_index_root, filename))
    for path in (
        os.path.join(OUTPUT, "catalog.json"),
        os.path.join(OUTPUT, "recipe-index.json"),
    ):
        if os.path.isfile(path):
            os.remove(path)
    chunks_root = os.path.join(OUTPUT, "chunks")
    if os.path.isdir(chunks_root):
        for root, _, files in os.walk(chunks_root):
            for filename in files:
                if filename.endswith(".json"):
                    os.remove(os.path.join(root, filename))

    catalog = {
        "pack": manifest.get("pack", {}),
        "minecraft": manifest.get("minecraft", ""),
        "counts": manifest.get("counts", {}),
        "mods": manifest.get("mods", {}),
        "categories": categories,
        "items": item_rows,
        "mobs": mob_rows,
        "recipeImageProbe": find_recipe_image_probe(categories),
    }
    write_gzip_json(os.path.join(OUTPUT, "catalog.json.gz"), catalog)
    write_gzip_json(os.path.join(OUTPUT, "recipe-index.json.gz"), recipe_refs)
    del item_rows, mob_rows, recipe_refs, catalog

    total_recipes = 0
    ingredient_refs = {}
    for category_index, category in enumerate(categories):
        recipe_file = os.path.join(BASE, category["dir"], "recipes.json")
        if not os.path.isfile(recipe_file):
            print(f"Missing recipe file: {recipe_file}", file=sys.stderr)
            return 1

        chunk = []
        recipe_index = 0
        for recipe in json_array(recipe_file):
            seen_ingredients = set()
            for group in recipe.get("in") or []:
                for ingredient in group or []:
                    if not ingredient or not isinstance(ingredient[0], str):
                        continue
                    key = ingredient[0]
                    if key not in seen_ingredients:
                        shard = ingredient_index_shard(key)
                        shard_refs = ingredient_refs.setdefault(shard, {})
                        shard_refs.setdefault(key, []).append([category_index, recipe_index])
                        seen_ingredients.add(key)
            chunk.append(recipe)
            recipe_index += 1
            if len(chunk) == CHUNK_SIZE:
                chunk_path = os.path.join(OUTPUT, "chunks", str(category_index), f"{(recipe_index - 1) // CHUNK_SIZE}.json.gz")
                write_gzip_json(chunk_path, chunk)
                chunk = []
        if chunk:
            chunk_path = os.path.join(OUTPUT, "chunks", str(category_index), f"{(recipe_index - 1) // CHUNK_SIZE}.json.gz")
            write_gzip_json(chunk_path, chunk)
        if category.get("count") is not None and recipe_index != category["count"]:
            print(
                f"Recipe count mismatch for {category['id']}: "
                f"expected {category['count']}, found {recipe_index}",
                file=sys.stderr,
            )
            return 1
        total_recipes += recipe_index
        print(f"[{category_index + 1}/{len(categories)}] {category['title']}: {recipe_index:,} recipes")

    os.makedirs(ingredient_index_root, exist_ok=True)
    for shard, refs in sorted(ingredient_refs.items()):
        write_gzip_json(os.path.join(ingredient_index_root, f"{shard}.json.gz"), refs)
    indexed_items = sum(len(refs) for refs in ingredient_refs.values())
    print(f"Prepared ingredient indexes for {indexed_items:,} items in {len(ingredient_refs)} shards")
    del ingredient_refs

    expected_recipes = manifest.get("counts", {}).get("recipes")
    if expected_recipes is not None and total_recipes != expected_recipes:
        print(
            f"Total recipe count mismatch: expected {expected_recipes}, found {total_recipes}",
            file=sys.stderr,
        )
        return 1
    print(f"Prepared {total_recipes:,} recipes in {OUTPUT}")
    print("Commit the generated viewer folder and the JEI image assets; do not commit the original export ZIP.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
