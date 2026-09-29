"""Проверки опубликованной структуры без запросов к внешним сервисам."""

from __future__ import annotations

import json
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "site" / "scripts"))
from build_static import BASE_URL, OUTPUT, ROUTES, author_translation_html, copy_texts, digest_file, markdown_table, original_transcription, purpose_html, transcription_route, transcription_section  # noqa: E402


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.panels = 0
        self.current_textarea = False
        self.textarea = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "section" and "data-panel" in attributes:
            self.panels += 1
        for name in ("href", "src"):
            if attributes.get(name):
                self.links.append(attributes[name])
        if tag == "textarea" and attributes.get("id") == "transcription-copy":
            self.current_textarea = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "textarea":
            self.current_textarea = False

    def handle_data(self, data: str) -> None:
        if self.current_textarea:
            self.textarea += data


class StaticBuildTest(unittest.TestCase):
    def test_markdown_table_has_headers_and_preserves_cells(self) -> None:
        source = ["| Уровень | Суть |", "| --- | --- |", "| Пшат | Прямой, буквальный смысл |"]
        result = markdown_table(source, BASE_URL)
        self.assertIn('<thead><tr><th scope="col">Уровень</th><th scope="col">Суть</th></tr></thead>', result)
        self.assertIn("<tbody><tr><td>Пшат</td><td>Прямой, буквальный смысл</td></tr></tbody>", result)

    def test_copy_falls_back_to_original_transcription(self) -> None:
        markdown = (ROOT / "docs" / "transcriptions" / "T00014.md").read_text(encoding="utf-8")
        original = original_transcription(markdown)
        self.assertTrue(original.startswith("Херувиме-н!"))
        parser = PageParser()
        parser.feed((OUTPUT / "transcriptions" / "T00014" / "index.html").read_text(encoding="utf-8"))
        self.assertEqual(original, parser.textarea)

    def test_copy_section_is_separate_from_original(self) -> None:
        markdown = "## Необработанная транскрипция\n\n> Исходная строка\n\n## Текст для копирования\n\n```\nСтрока с маленькой корректировкой\n```\n"
        self.assertEqual("Исходная строка", original_transcription(markdown))
        self.assertEqual("Строка с маленькой корректировкой", transcription_section(markdown, "Текст для копирования"))

    def test_author_translation_uses_only_explicit_translation(self) -> None:
        translated = (ROOT / "docs" / "transcriptions" / "T00033" / "part_1.md").read_text(encoding="utf-8")
        summary_only = (ROOT / "docs" / "transcriptions" / "T00027" / "part_1.md").read_text(encoding="utf-8")
        self.assertIn("Труби! Приди, живой!", author_translation_html(translated, BASE_URL))
        self.assertEqual('<p>Пока не заполнено</p>', author_translation_html(summary_only, BASE_URL))
        self.assertNotIn("Составители предложили", author_translation_html(summary_only, BASE_URL))

        page = (OUTPUT / "help" / "purpose" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Труби! Приди, живой!", page)
        self.assertNotIn('data-author-translation="', page)
        self.assertNotIn('<label for="purpose-text-1">', page)
        self.assertLess(page.index('id="purpose-text-1"'), page.index('class="author-translation"'))
        self.assertLess(page.index('class="author-translation"'), page.index('class="sos-actions"'))

        transcription_page = (OUTPUT / "transcriptions" / "T00033" / "part_1" / "index.html").read_text(encoding="utf-8")
        self.assertLess(transcription_page.index('id="transcription-copy"'), transcription_page.index('class="author-translation"'))
        self.assertLess(transcription_page.index('class="author-translation"'), transcription_page.index('class="sos-actions"'))

    def test_purpose_uses_only_the_specific_card(self) -> None:
        transcription_dir = ROOT / "docs" / "transcriptions"
        direct = purpose_html(transcription_dir / "T00027" / "part_1.md")
        self.assertIn("Просьба о защите Наташи", direct)

        self.assertEqual('<p>Пока не заполнено</p>', purpose_html(transcription_dir / "T00033" / "part_1.md"))
        self.assertEqual('<p>Пока не заполнено</p>', purpose_html(transcription_dir / "T00034" / "part_1.md"))

        page = (OUTPUT / "help" / "purpose" / "index.html").read_text(encoding="utf-8")
        self.assertLess(page.index('class="transcription-purpose"'), page.index('id="purpose-text-1"'))
        self.assertNotIn('data-purpose-source="', page)
        self.assertIn("Пока не заполнено", page)

        transcription_page = (OUTPUT / "transcriptions" / "T00033" / "part_1" / "index.html").read_text(encoding="utf-8")
        self.assertLess(transcription_page.index('class="transcription-purpose"'), transcription_page.index('id="transcription-copy"'))
        self.assertLess(transcription_page.index('id="transcription-copy"'), transcription_page.index('class="author-translation"'))

        purposes = json.loads((ROOT / "site" / "public_html" / "data" / "transcription-purposes.json").read_text(encoding="utf-8"))
        self.assertEqual(17, (ROOT / "site" / "public_html" / "index.html").read_text(encoding="utf-8").count('class="transcription-purpose"'))
        self.assertEqual("<p>Пока не заполнено</p>", purposes["docs/transcriptions/T00033/part_1.md"])
        self.assertEqual("<p>Пока не заполнено</p>", purposes["docs/transcriptions/T00034/part_1.md"])

    def test_author_help_page_links_verses_in_words(self) -> None:
        page = (OUTPUT / "help" / "author" / "index.html").read_text(encoding="utf-8")
        for verse, words in (
            ("Rom.10:9", "Господом"),
            ("Lk.2:11", "Спасителем"),
            ("Lk.1:35", "рождённым"),
            ("Mt.1:20-21", "от Духа Святого и Девы Марии"),
        ):
            with self.subTest(verse=verse):
                self.assertIn(f'<a href="https://azbyka.ru/biblia/?{verse}&amp;r">{words}</a>', page)

        self.assertIn("Автор имеет цель перевести все транскрипции", page)
        self.assertIn("Враг силён но только Бог всесилен.", page)

    def test_pages_and_local_links(self) -> None:
        pages = list(OUTPUT.rglob("index.html"))
        source = (ROOT / "site" / "public_html" / "index.html").read_text(encoding="utf-8")
        entries = json.loads((ROOT / "site" / "public_html" / "data" / "entries.json").read_text(encoding="utf-8"))
        published = {entry["sourceUrl"].split("/blob/main/", 1)[1] for entry in entries if entry.get("published")}
        published.update(copy_texts(source))
        self.assertEqual(len(ROUTES) + len(published), len(pages))
        self.assertEqual(len(ROUTES), len([page for page in pages if "transcriptions" not in page.parts]))

        for page in pages:
            with self.subTest(page=page):
                parser = PageParser()
                parser.feed(page.read_text(encoding="utf-8"))
                self.assertEqual(1, parser.panels)
                for link in parser.links:
                    parsed = urlsplit(link)
                    if parsed.scheme or link.startswith("#"):
                        continue
                    self.assertFalse(link.startswith("#about"))
                    target = OUTPUT / parsed.path.lstrip("/")
                    if parsed.path.endswith("/"):
                        target /= "index.html"
                    self.assertTrue(target.is_file(), f"{page}: {link}")

    def test_copy_text_and_source_manifest(self) -> None:
        source = (ROOT / "site" / "public_html" / "index.html").read_text(encoding="utf-8")
        texts = copy_texts(source)
        relative = "docs/transcriptions/T00032/part_2.md"
        page = OUTPUT / transcription_route(ROOT / relative).lstrip("/") / "index.html"
        parser = PageParser()
        parser.feed(page.read_text(encoding="utf-8"))
        self.assertEqual(texts[relative], parser.textarea)

        manifest = json.loads((OUTPUT / "content-manifest.json").read_text(encoding="utf-8"))
        for path, expected in manifest["sources"].items():
            with self.subTest(path=path):
                self.assertEqual(expected, digest_file(ROOT / path))
        self.assertEqual((ROOT / "site" / "content-manifest.json").read_bytes(), (OUTPUT / "content-manifest.json").read_bytes())

    def test_sitemap_contains_each_page(self) -> None:
        sitemap = (OUTPUT / "sitemap.xml").read_text(encoding="utf-8")
        for page in OUTPUT.rglob("index.html"):
            route = "/" + str(page.parent.relative_to(OUTPUT)).replace("\\", "/").strip("/")
            route = "/" if route == "/." else route.rstrip("/") + "/"
            self.assertIn(f"<loc>{BASE_URL}{route}</loc>", sitemap)


if __name__ == "__main__":
    unittest.main()
