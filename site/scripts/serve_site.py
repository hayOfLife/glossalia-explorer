"""Локальный просмотр статического сайта с явной кодировкой текстовых файлов."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class UTF8RequestHandler(SimpleHTTPRequestHandler):
    def guess_type(self, path: str) -> str:
        media_type = super().guess_type(path)
        if media_type.startswith("text/"):
            return media_type + "; charset=utf-8"
        return media_type


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[1] / "build")
    args = parser.parse_args()
    directory = args.directory.resolve()
    if not directory.is_dir():
        parser.error(f"Каталог сборки не найден: {directory}")

    handler = partial(UTF8RequestHandler, directory=str(directory))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f"Локальный сайт: http://{args.bind}:{args.port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
