"""Сравнить маленькие манифесты GitHub и опубликованного сайта."""

from __future__ import annotations

import json
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


GITHUB = "https://raw.githubusercontent.com/hayOfLife/glossalia-explorer/main/site/content-manifest.json"
SITE = "https://glossalia-explorer.tuqo.ru/content-manifest.json"


def fetch(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "glossolalia-site-sync/1", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=15) as response:
        data = response.read(512_001)
    if len(data) > 512_000:
        raise ValueError(f"Слишком большой манифест: {url}")
    manifest = json.loads(data)
    if manifest.get("schema") != 1 or not isinstance(manifest.get("sources"), dict):
        raise ValueError(f"Неизвестный формат манифеста: {url}")
    return manifest


def main() -> int:
    try:
        github = fetch(GITHUB)["sources"]
        site = fetch(SITE)["sources"]
    except (URLError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Не удалось проверить сайт: {error}", file=sys.stderr)
        return 2

    changed = [path for path in sorted(github.keys() | site.keys()) if github.get(path) != site.get(path)]
    if changed:
        print("Сайт отличается от GitHub:")
        for path in changed:
            print(f"  {path}")
        return 1

    print(f"Сайт соответствует GitHub: {len(github)} исходных файлов")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
