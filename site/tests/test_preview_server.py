"""Проверки кодировки HTTP-ответов локального просмотра без внешних запросов."""

from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "site" / "scripts"))
from serve_site import UTF8RequestHandler  # noqa: E402


class PreviewServerTest(unittest.TestCase):
    def test_utf8_text_headers_preserve_text_and_binary_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            text = "Теория глоссалии — дополнительная информация\n".encode("utf-8")
            files = {"theory.md": text, "prompt.txt": text, "index.html": text, "icon.png": b"\x89PNG\r\n\x1a\n"}
            for filename, data in files.items():
                (directory / filename).write_bytes(data)

            handler = partial(UTF8RequestHandler, directory=temporary)
            with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    for filename, expected in files.items():
                        with self.subTest(file=filename):
                            with urlopen(f"http://127.0.0.1:{server.server_port}/{filename}", timeout=5) as response:
                                self.assertEqual(expected, response.read())
                                if filename.endswith(".png"):
                                    self.assertEqual("image/png", response.headers.get_content_type())
                                    self.assertIsNone(response.headers.get_content_charset())
                                else:
                                    self.assertEqual("utf-8", response.headers.get_content_charset())
                finally:
                    server.shutdown()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
