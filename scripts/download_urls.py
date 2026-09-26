#!/usr/bin/env python3
"""Download Doubao HD image URL list exported from the console script.

Usage:
  python scripts/download_urls.py urls.json -o downloads/nainai-courtyard
  python scripts/download_urls.py urls.json -o downloads/out --limit 3
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def file_id(url: str) -> str | None:
    m = re.search(r"super_tool/([a-f0-9]+\.(?:jpg|jpeg|png|webp))", url, re.I)
    return m.group(1) if m else None


def load_items(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "dld" in data:
        # tolerate raw extract dump
        urls = data.get("raw") or data.get("dld") or []
        data = [{"url": u} for u in urls if "byteimg.com" in u]
    if not isinstance(data, list):
        raise SystemExit("JSON must be a list of {url,...} or {dld/raw:[...]}")

    items = []
    seen = set()
    for i, row in enumerate(data, 1):
        url = row.get("url") if isinstance(row, dict) else str(row)
        if not url or "byteimg.com" not in url:
            continue
        if "www.doubao.com" in url:
            continue
        fid = file_id(url) or f"img_{i}"
        if fid in seen:
            continue
        seen.add(fid)
        name = row.get("name") if isinstance(row, dict) else None
        if not name:
            stem = re.sub(r"\.(jpg|jpeg)$", "", fid, flags=re.I)
            name = f"{len(items)+1:02d}_{stem}.png"
        items.append({"url": url, "name": name, "id": fid})
    return items


def download(url: str, dest: Path, timeout: int = 120) -> int:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; doubao-download/1.0)",
            "Referer": "https://www.doubao.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return len(data)


def main() -> int:
    p = argparse.ArgumentParser(description="Batch download Doubao HD image URLs")
    p.add_argument("json_file", type=Path, help="URL list from console script")
    p.add_argument("-o", "--out", type=Path, default=Path("downloads/out"))
    p.add_argument("--limit", type=int, default=0, help="Only first N images")
    p.add_argument("--delay", type=float, default=0.2)
    args = p.parse_args()

    items = load_items(args.json_file)
    if args.limit:
        items = items[: args.limit]
    args.out.mkdir(parents=True, exist_ok=True)

    ok = fail = 0
    for item in items:
        dest = args.out / item["name"]
        try:
            n = download(item["url"], dest)
            print(f"OK  {dest.name}  ({n/1048576:.2f} MB)")
            ok += 1
        except (urllib.error.URLError, OSError) as e:
            print(f"FAIL {item['name']}: {e}", file=sys.stderr)
            fail += 1
        time.sleep(args.delay)

    print(f"Done: {ok} ok, {fail} fail → {args.out.resolve()}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
