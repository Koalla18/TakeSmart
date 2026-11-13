#!/usr/bin/env python3
"""Собирает логотипы приложений, которых нет в российском App Store (банки и прочие удалённые).

Зачем: помощник на Mac берёт иконки из iTunes Lookup, а для удалённых приложений Apple
ничего не отдаёт — в PWA вместо иконки была бы буква. Здесь логотипы собираются один раз
и кладутся в public/app-icons/id/<App Store ID>.webp (120×120, ~5 КБ).

Откуда берётся иконка, по порядку:
  1. iTunes Lookup других стран (us, kz, by…) — приложение убрали только из РФ;
  2. архив страниц App Store (web.archive.org): адрес старой иконки на mzstatic.com
     там сохранился, а сама картинка у Apple до сих пор лежит.

Кандидаты: список популярных приложений IPA_Downloader (≈700, в основном российские) и,
по желанию, JSON-файлы с историей покупок (--purchases), из которых берутся только
русские приложения (кириллица в названии или bundle ru.*).

Запуск (из папки frontend):
    python3 scripts/build_store_icons.py [--purchases ~/.ipa-cli/purchases.json]

Результат: файлы иконок + src/lib/storeIcons.ts (какие ID удалены из российского
App Store и для каких есть иконка). Повторный запуск докачивает только новое.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "app-icons" / "id"
TS_FILE = ROOT / "src" / "lib" / "storeIcons.ts"
POPULAR_URL = "https://raw.githubusercontent.com/kda2495/IPA_Downloader/refs/heads/main/Files/AppsList.txt"
OTHER_STORES = ["us", "kz", "by", "am", "ge", "uz", "ae", "tr"]
SIZE = "120x120bb.webp"


def get(url: str, timeout: int = 30) -> bytes:
    p = subprocess.run(["curl", "-fsSL", "--max-time", str(timeout), url], capture_output=True)
    if p.returncode != 0:
        raise OSError(p.stderr.decode("utf-8", "replace").strip() or f"curl {p.returncode}")
    return p.stdout


def lookup(ids: list[str], country: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        try:
            data = json.loads(get(f"https://itunes.apple.com/lookup?id={','.join(chunk)}&country={country}&entity=software"))
        except (OSError, ValueError) as e:
            print(f"  lookup {country}: {e}", file=sys.stderr)
            continue
        for r in data.get("results") or []:
            if r.get("trackId"):
                found[str(r["trackId"])] = r
    return found


def resized(url: str) -> str:
    """mzstatic отдаёт картинку любого размера и формата: меняем последний сегмент пути."""
    return url.rsplit("/", 1)[0] + "/" + SIZE


ARCHIVE_URLS = (
    "apps.apple.com/ru/app/id{id}",
    "apps.apple.com/us/app/id{id}",
    "apps.apple.com/app/id{id}",
    "itunes.apple.com/ru/app/id{id}",   # старый адрес страниц App Store (до 2019)
    "itunes.apple.com/app/id{id}",
    "itunes.apple.com/us/app/id{id}",
)


def from_archive(app_id: str) -> str | None:
    for pattern in ARCHIVE_URLS:
        try:
            avail = json.loads(get(f"https://archive.org/wayback/available?url={pattern.format(id=app_id)}", 20))
        except (OSError, ValueError):
            continue
        snap = (avail.get("archived_snapshots") or {}).get("closest") or {}
        if not snap.get("url"):
            continue
        raw = re.sub(r"/web/(\d+)/", r"/web/\1id_/", snap["url"])
        try:
            html = get(raw, 40).decode("utf-8", "replace")
        except OSError:
            continue
        m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
        if m and "mzstatic.com" in m[1]:
            return resized(m[1])
    return None


def candidates(purchase_files: list[Path]) -> dict[str, str]:
    """{App Store ID: название}"""
    apps: dict[str, str] = {}
    text = get(POPULAR_URL).decode("utf-8")
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" in line:
            name, ref = line.rsplit(":", 1)
            ref = ref.strip().split()[0] if ref.strip() else ""
            if ref.isdigit():
                apps[ref] = name.strip()
    for f in purchase_files:
        data = json.loads(f.expanduser().read_text(encoding="utf-8"))
        for a in data.get("apps", data if isinstance(data, list) else []):
            app_id, name, bundle = str(a.get("id") or ""), a.get("name") or "", (a.get("bundle") or a.get("bundle_id") or "").lower()
            if app_id.isdigit() and (re.search(r"[а-яё]", name, re.I) or bundle.startswith("ru.")):
                apps.setdefault(app_id, name)
    return apps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--purchases", type=Path, action="append", default=[], help="JSON с историей покупок")
    args = ap.parse_args()

    apps = candidates(args.purchases)
    print(f"Кандидатов: {len(apps)}")
    ids = list(apps)
    in_ru = lookup(ids, "ru")
    removed = [i for i in ids if i not in in_ru]
    print(f"Есть в российском App Store: {len(in_ru)}, удалены: {len(removed)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in OUT_DIR.glob("*.webp")}
    todo = [i for i in removed if i not in have]
    sources: dict[str, str] = {}
    left = todo
    for cc in OTHER_STORES:
        if not left:
            break
        found = lookup(left, cc)
        for i, r in found.items():
            url = r.get("artworkUrl512") or r.get("artworkUrl100")
            if url:
                sources[i] = resized(url)
        left = [i for i in left if i not in sources]
    # «Авито (Anero)», «Rutube (Starship Battle)» — в списке IPA_Downloader это банки и сервисы под
    # чужим приложением-прикрытием: иконка была бы от прикрытия, в архиве их не ищем.
    left = [i for i in left if "(" not in apps[i]]
    print(f"Нашлись в других странах: {len(sources)}; ищу в архиве App Store: {len(left)}")

    def archive(i: str) -> tuple[str, str | None]:
        time.sleep(0.3)
        return i, from_archive(i)

    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, url in ex.map(archive, left):
            if url:
                sources[i] = url

    def fetch(item: tuple[str, str]) -> tuple[str, bool]:
        i, url = item
        try:
            data = get(url, 30)
            if not data.startswith(b"RIFF"):
                return i, False
            (OUT_DIR / f"{i}.webp").write_bytes(data)
            return i, True
        except OSError:
            return i, False

    with ThreadPoolExecutor(max_workers=6) as ex:
        got = [i for i, ok in ex.map(fetch, sources.items()) if ok]
    have |= set(got)
    missing = [i for i in removed if i not in have]
    print(f"Скачано новых иконок: {len(got)}; всего в наборе: {len(have)}; без иконки: {len(missing)}")
    if missing:
        print("  без иконки:", ", ".join(apps[i] for i in missing[:40]) + (" …" if len(missing) > 40 else ""))

    # Удалённые = всё, что сейчас не находится в российском App Store, плюс то, что уже было в наборе
    removed_all = sorted(set(removed) | have, key=int)
    with_icon = sorted(have, key=int)
    TS_FILE.write_text(
        "// Сгенерировано scripts/build_store_icons.py — руками не править, перезапустите скрипт.\n"
        "// Приложения, которых нет в российском App Store (на момент сборки), и для каких из них\n"
        "// лежит логотип public/app-icons/id/<App Store ID>.webp.\n\n"
        f"export const REMOVED_FROM_RU_STORE = new Set<string>({json.dumps(removed_all)})\n\n"
        f"export const STORE_ID_ICONS = new Set<string>({json.dumps(with_icon)})\n\n"
        "export function storeIdIcon(id: string | number | null | undefined): string | null {\n"
        "  const key = id == null ? '' : String(id)\n"
        "  return STORE_ID_ICONS.has(key) ? `/app-icons/id/${key}.webp` : null\n"
        "}\n",
        encoding="utf-8",
    )
    size = sum(p.stat().st_size for p in OUT_DIR.glob("*.webp"))
    print(f"Набор: {len(have)} файлов, {size / 1024:.0f} КБ → {OUT_DIR.relative_to(ROOT)}; список → {TS_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
