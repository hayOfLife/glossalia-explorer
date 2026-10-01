"""Проверки опубликованной структуры без запросов к внешним сервисам."""

from __future__ import annotations

import html
import json
import re
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "site" / "scripts"))
from build_static import BASE_URL, OUTPUT, ROUTES, CHAT_TEMPLATE, analysis_label, analysis_mode, attach_block_reactions, inline, markdown_html, author_translation_html, copy_texts, dictionary_fields, dictionary_html, digest_file, markdown_table, original_transcription, purpose_html, reaction_key, sos_item_blocks, transcription_route, transcription_section  # noqa: E402


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.panels = 0
        self.current_textarea = False
        self.textarea = ""
        self.csp = ""
        self.reactions: list[str] = []
        self.chats: list[str] = []
        self.chat_hidden: list[bool] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div" and attributes.get("data-transcription-reaction"):
            self.reactions.append(attributes["data-transcription-reaction"])
        if tag == "div" and attributes.get("data-transcription-chat"):
            self.chats.append(attributes["data-transcription-chat"])
            self.chat_hidden.append("hidden" in attributes)
        if tag == "meta" and attributes.get("http-equiv") == "Content-Security-Policy":
            self.csp = attributes.get("content", "")
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
    def test_comments_are_hidden_and_share_each_transcription_key(self) -> None:
        for path in OUTPUT.rglob("index.html"):
            with self.subTest(page=path):
                parser = PageParser()
                page = path.read_text(encoding="utf-8")
                parser.feed(page)
                expected = parser.reactions + (["for-ai"] if path.parent == OUTPUT / "for-ai" else [])
                self.assertCountEqual(expected, parser.chats)
                self.assertTrue(all(parser.chat_hidden))
                self.assertIn('/assets/comments.js?v=author-inbox-20261001', page)
                self.assertIn('/assets/styles.css?v=reading-controls-20261001', page)
                if parser.chats:
                    self.assertIn('data-chat-api="https://94-232-41-163.sslip.io/glossaliae/comments"', page)

    def test_comments_template_and_general_ai_chat_position(self) -> None:
        source = (ROOT / "site/public_html/index.html").read_text(encoding="utf-8")
        matches = list(CHAT_TEMPLATE.finditer(source))
        self.assertEqual(1, len(matches))
        template = matches[0].group(1)
        self.assertEqual(1, template.count('data-transcription-chat=""'))
        self.assertIn('data-chat-rules', template)
        self.assertIn('Технические правила пользования чатом', template)
        self.assertIn('glossaliae-comment-author', template)
        self.assertIn('"action":"create","key":"KEY","text":"MESSAGE","authorToken":"TOKEN_64_HEX","replyTo":null', template)
        self.assertIn('"replyTo":"user_001"', template)
        self.assertIn('<code>user_001</code>–<code>user_100</code> зарезервированы', template)
        self.assertNotIn('name="name"', template)
        notice = ('Дисклэймер: Уважаемые "хацкеры" и искуственные интелекты! пожалуйста без оффтопа. '
                  'Чат специально скрыт чтобы спасти сайт ох хейта, так как людям очень ненравиться '
                  'когда говорят о релии не так как они привыкли.')
        self.assertIn(notice, html.unescape(re.sub(r'<[^>]+>', '', template)))
        ai_page = (OUTPUT / "for-ai/index.html").read_text(encoding="utf-8")
        panel = re.search(r'<section[^>]+id="for-ai"[^>]*>(.*?)</section>', ai_page, re.S).group(1)
        self.assertGreater(panel.index('data-transcription-chat="for-ai"'), panel.index('id="channel-dictionary-content"'))
        self.assertEqual(1, panel.count('data-transcription-chat="for-ai"'))
        self.assertIn('"replyTo":"user_001"', panel)

    def test_rebuilding_inline_chat_placeholders_is_idempotent(self) -> None:
        source = (ROOT / "site/public_html/index.html").read_text(encoding="utf-8")
        entries = json.loads((ROOT / "site/public_html/data/entries.json").read_text(encoding="utf-8"))
        by_source = {entry['sourceUrl'].split('/blob/main/', 1)[1]: entry for entry in entries if entry.get('published')}
        texts = copy_texts(source)
        keys = {relative: reaction_key(relative, by_source.get(relative)) for relative in set(by_source) | set(texts)}
        first, first_keys = attach_block_reactions(source, keys, texts)
        second, second_keys = attach_block_reactions(first, keys, texts)
        self.assertEqual(first, second)
        self.assertEqual(first_keys, second_keys)

    def test_all_transcription_pages_share_manifest_keys_with_calendar(self) -> None:
        manifest = json.loads((ROOT / "site/reactions-api/transcriptions.json").read_text(encoding="utf-8"))
        keys = manifest["keys"]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue({"T00014", "T00016", "T00017", "T00018", "T00019", "T00020"}.issubset(keys))
        entries = json.loads((OUTPUT / "data/entries.json").read_text(encoding="utf-8"))
        for entry in entries:
            if entry.get("published") and entry["type"] in {"manual_transcription", "analysis"}:
                with self.subTest(entry=entry["externalKey"]):
                    key = entry["reactionKey"]
                    self.assertIn(key, keys)
                    parser = PageParser()
                    relative = entry["sourceUrl"].split("/blob/main/", 1)[1]
                    route = transcription_route(ROOT / relative)
                    parser.feed((OUTPUT / route.lstrip("/") / "index.html").read_text(encoding="utf-8"))
                    self.assertEqual([key], parser.reactions)
            else:
                self.assertNotIn("reactionKey", entry)

        for path in (OUTPUT / "transcriptions").rglob("index.html"):
            with self.subTest(page=path):
                parser = PageParser()
                parser.feed(path.read_text(encoding="utf-8"))
                self.assertEqual(1, len(parser.reactions))
                self.assertIn(parser.reactions[0], keys)

    def test_only_filled_transcription_blocks_get_reactions(self) -> None:
        source = (ROOT / "site/public_html/index.html").read_text(encoding="utf-8")
        keys = json.loads((ROOT / "site/reactions-api/transcriptions.json").read_text(encoding="utf-8"))["keys"]
        for block in sos_item_blocks(source):
            parser = PageParser()
            parser.feed(block)
            field = re.search(r'<textarea\b[^>]*>(.*?)</textarea>', block, re.S)
            self.assertEqual(1 if field and html.unescape(field.group(1)).strip() else 0, len(parser.reactions))
            for key in parser.reactions:
                self.assertIn(key, keys)

        for route in ("news", "situations", "help/churches"):
            parser = PageParser()
            parser.feed((OUTPUT / route / "index.html").read_text(encoding="utf-8"))
            self.assertEqual([], parser.reactions)

    def test_repeated_ai_transcription_uses_one_counter(self) -> None:
        key = reaction_key("docs/transcriptions/T00035/script12_analysis_full.md")
        for route in ("help/ai", "for-ai", "transcriptions/T00035/script12_analysis_full"):
            parser = PageParser()
            parser.feed((OUTPUT / route / "index.html").read_text(encoding="utf-8"))
            self.assertEqual(1, parser.reactions.count(key))

    def test_author_name_is_replaced_in_published_transcriptions(self) -> None:
        for path in (ROOT / "docs/transcriptions").rglob("*.md"):
            with self.subTest(source=path):
                self.assertNotRegex(path.read_text(encoding="utf-8"), r"\bВасили(?:й|я|ю|ем|и)\b")

        page = (OUTPUT / "transcriptions/T00027/part_8/index.html").read_text(encoding="utf-8")
        self.assertIn("Автор№1:", page)

    def test_markdown_links_preserve_query_parameters(self) -> None:
        target = "https://gramota.ru/?mode=slovari&query=слово&simple=0"
        parser = PageParser()
        parser.feed(inline(f"[Словарь]({target})"))
        self.assertEqual([target], parser.links)

    def test_page_policy_allows_reaction_requests(self) -> None:
        script = (ROOT / "site/public_html/assets/site.js").read_text(encoding="utf-8")
        endpoints = re.findall(r'const (?:production|local)ReactionApiUrl = "([^"]+)";', script)
        self.assertEqual(2, len(endpoints))
        endpoints.append("https://94-232-41-163.sslip.io/glossaliae/comments")

        for path in OUTPUT.rglob("index.html"):
            with self.subTest(page=path):
                parser = PageParser()
                parser.feed(path.read_text(encoding="utf-8"))
                directives = dict((tokens[0], tokens[1:]) for rule in parser.csp.split(";") if (tokens := rule.split()))
                connect_sources = directives.get("connect-src", [])
                for endpoint in endpoints:
                    address = urlsplit(endpoint)
                    if address.netloc:
                        origin = f"{address.scheme}://{address.netloc}"
                        allowed = endpoint in connect_sources or origin in connect_sources
                    else:
                        allowed = "'self'" in connect_sources
                    self.assertTrue(allowed, f"CSP не разрешает запросы к {endpoint}")

    def test_sos_part_seven_copies_both_source_blocks(self) -> None:
        source = (ROOT / "docs" / "transcriptions" / "T00027" / "part_7.md").read_text(encoding="utf-8")
        first = re.search(r"^\*\*Блок 1[^\n]*\*\*\s*\n(.*?)(?=^\*\*Блок 2)", source, re.M | re.S).group(1).strip()
        second = re.search(r"^\*\*Блок 2[^\n]*\*\*\s*\n(.*?)(?=^---\s*$)", source, re.M | re.S).group(1).strip()
        expected = html.escape(first + "\n\n" + second)
        page = (OUTPUT / "sos" / "index.html").read_text(encoding="utf-8")

        self.assertIn(f'<textarea id="sos-text-8" aria-label="Текст для копирования" readonly rows="6">{expected}</textarea>', page)
        self.assertIn("пришло после просьбы к Богу  избавить меня от злых существ атакующих меня", page)

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

    def test_three_level_connected_translation_preserves_source_sections(self) -> None:
        markdown = (ROOT / "docs/transcriptions/T00042/part_1.md").read_text(encoding="utf-8")
        section = re.search(r'^## Всё послание связным текстом\s*\n(.*?)(?=^## |\Z)', markdown, re.M | re.S).group(1)
        expected = markdown_html(section.strip().removesuffix("---").strip(), BASE_URL)
        rendered = author_translation_html(markdown, BASE_URL)
        self.assertEqual(expected, rendered)
        for heading in ("Пешат (буквально)", "Драш (толкование)", "Сод (тайна)"):
            self.assertIn(heading, rendered)
        self.assertIn("Целители — это: пиши, помни, познай", rendered)
        self.assertNotIn("Кросс-фрагментные корни", rendered)

    def test_numbered_lists_preserve_item_numbers_and_close_before_other_blocks(self) -> None:
        source = "1. **Запрос** — дай\n2. Регистрация\n- Приписка\n4) Возврат\n---\n7. Корень\n| Слово | Значение |\n| --- | --- |\n| Руфим | Целители |\n"
        rendered = markdown_html(source, BASE_URL)
        self.assertIn('<ol>\n<li value="1"><strong>Запрос</strong> — дай</li>\n<li value="2">Регистрация</li>\n</ol>\n<ul>', rendered)
        self.assertIn('</ul>\n<ol start="4">\n<li value="4">Возврат</li>\n</ol>\n<hr>', rendered)
        self.assertIn('<ol start="7">\n<li value="7">Корень</li>\n</ol>\n<div class="source-table-wrap">', rendered)
        self.assertEqual(3, rendered.count("</ol>"))

    def test_empty_quote_separator_is_not_visible_text(self) -> None:
        rendered = markdown_html("> Послание\n>\n> Приписка\n\n1. Действие\n```text\n2. Исходная строка\n```\n# Конец", BASE_URL)
        self.assertIn('<blockquote>Послание</blockquote>\n<blockquote>Приписка</blockquote>', rendered)
        self.assertNotIn('&gt;', rendered)
        self.assertIn('<li value="1">Действие</li>\n</ol>\n<pre><code>\n2. Исходная строка', rendered)
        self.assertIn('<h2>Конец</h2>', rendered)

    def test_word_by_word_translation_marks_labels_without_changing_text(self) -> None:
        markdown = (ROOT / "docs/transcriptions/T00041/part_1.md").read_text(encoding="utf-8")
        section = re.search(r'^## Итоговый перевод\s*\n(.*)', markdown, re.S | re.M).group(1).strip()
        rendered = author_translation_html(markdown, BASE_URL)
        unmarked = re.sub(r'<mark class="transcription-term">(.*?)</mark>', r'\1', rendered, flags=re.S)
        self.assertEqual(markdown_html(section, BASE_URL), unmarked)
        for label in ("Еффа!", "Едро! Фиктим. Ишма!", "Шуея-нарратив, егоистед или Ещуа!", "Дерувинтриум!"):
            self.assertIn(f'<mark class="transcription-term">{label}</mark>', rendered)
        self.assertNotIn('<mark class="transcription-term">Я — факт!', rendered)
        for route in ("situations/agnosticism", "transcriptions/T00041/part_1"):
            page = (OUTPUT / route / "index.html").read_text(encoding="utf-8")
            self.assertIn('<mark class="transcription-term">Еффа!</mark>', page)

    def test_russian_translation_remains_unmarked(self) -> None:
        markdown = (ROOT / "docs/transcriptions/T00032/part_1.md").read_text(encoding="utf-8")
        rendered = author_translation_html(markdown, BASE_URL)
        self.assertIn("Херувимы! Обет — видь!", rendered)
        self.assertNotIn('<mark', rendered)

    def test_word_translation_does_not_mark_russian_conclusions(self) -> None:
        markdown = ('## Необработанная транскрипция\n\nЕффа! Ишма!\n\n'
                    '## Итоговый перевод\n\nЕффа!\nЯ — факт!\n\nИшма!\nУслышит.\n\n'
                    'Всё это означает:\nРусское итоговое пояснение.\n\nСпасибо Богу!\nИтоговая молитва.\n')
        rendered = author_translation_html(markdown, BASE_URL)
        self.assertEqual(2, rendered.count('<mark class="transcription-term">'))
        self.assertIn('<p>Всё это означает: Русское итоговое пояснение.</p>', rendered)
        self.assertIn('<p>Спасибо Богу! Итоговая молитва.</p>', rendered)

    def test_explicit_translation_pair_keeps_markup_and_escaping(self) -> None:
        markdown = ('## Необработанная транскрипция\n\nЕффа!\n\n'
                    '## Итоговый перевод\n\n**Еффа!** → Я — факт! <script>\n')
        rendered = author_translation_html(markdown, BASE_URL)
        self.assertEqual('<p><mark class="transcription-term"><strong>Еффа!</strong></mark> → Я — факт! &lt;script&gt;</p>', rendered)
        unrelated = markdown.replace('**Еффа!** →', 'Важный вывод →')
        self.assertNotIn('<mark', author_translation_html(unrelated, BASE_URL))

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
        self.assertEqual(27, (ROOT / "site" / "public_html" / "index.html").read_text(encoding="utf-8").count('class="transcription-purpose"'))
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

    def test_analysis_mode_detection_and_metadata(self) -> None:
        self.assertEqual("auto", analysis_mode("Обычный разбор"))
        self.assertEqual("manual", analysis_mode("## ПОМЕТКИ АВТОРА"))
        self.assertEqual("manual", analysis_mode("Это уточнено автором"))
        self.assertEqual("auto", analysis_mode("неуточненное"))
        self.assertEqual("manual", analysis_mode("разбор транскрипции: ручной, 100%\n\nОбычный разбор"))
        self.assertEqual("auto", analysis_mode("разбор транскрипции: авто\n\nПометки автора"))
        self.assertEqual("95%", analysis_mode("разбор транскрипции: 95%\n\nПометки автора"))
        self.assertEqual("Разбор транскрипции: 95%", analysis_label("95%"))
        self.assertEqual("Разбор транскрипции: авто", analysis_label("101%"))
        rendered = markdown_html("разбор транскрипции: ручной, 100%\n\n# Разбор\n\nИсходный текст", "https://example.com/")
        self.assertNotIn("разбор транскрипции:", rendered)
        self.assertIn("Исходный текст", rendered)
        self.assertNotIn("разбор транскрипции:", markdown_html("разбор транскрипции: 95%\n\n# Разбор", "https://example.com/"))

    def test_analysis_labels_follow_copy_fields(self) -> None:
        for page_path in OUTPUT.rglob("index.html"):
            page = page_path.read_text(encoding="utf-8")
            fields = re.findall(r'<textarea\b(?=[^>]*\breadonly\b)[^>]*>.*?</textarea>(.*?)(?=<textarea|$)', page, re.S)
            for after_field in fields:
                self.assertRegex(after_field, r'^\s*<p class="analysis-mode">Разбор транскрипции: (?:авто|(?:100|[1-9]?\d)%)</p>')
        relative = "docs/transcriptions/T00027/part_8.md"
        page = (OUTPUT / "transcriptions/T00027/part_8/index.html").read_text(encoding="utf-8")
        self.assertIn("Разбор транскрипции: 100%", page)
        entries = json.loads((OUTPUT / "data/entries.json").read_text(encoding="utf-8"))
        entry = next(entry for entry in entries if entry["sourceUrl"].endswith(relative))
        self.assertEqual("manual", entry["analysisMode"])
        template = (ROOT / "site/public_html/index.html").read_text(encoding="utf-8")
        self.assertIn(f'data-analysis-source="{relative}">Разбор транскрипции: 100%</p>', template)

    def test_dictionary_is_merged_and_built_into_ai_page(self) -> None:
        markdown = (ROOT / "docs/dictionary/combined.md").read_text(encoding="utf-8")
        table = (OUTPUT / "data/dictionary.html").read_text(encoding="utf-8")
        page = (OUTPUT / "for-ai/index.html").read_text(encoding="utf-8")
        embedded_table = re.sub(
            r'href="https://github\.com/hayOfLife/glossalia-explorer/blob/main/(docs/transcriptions/[^\"]+\.md)"',
            lambda match: f'href="{transcription_route(ROOT / match.group(1))}"',
            table,
        )
        self.assertTrue(embedded_table in page, "Встроенный словарь с локальными ссылками отсутствует на странице для ИИ")
        self.assertEqual(len(re.findall(r"^## ", markdown, re.M)), table.count('<th scope="row"'))
        for term in ("Веритоне", "Едро", "Турефине", "GLO-001", "RUVI-051", "CHAT25-007"):
            self.assertIn(term, table)
        self.assertIn("(альтернатива)", table)
        self.assertIn("ПОВТОРЯЮЩИЕСЯ", (ROOT / "docs/dictionary/slovar_kanala.md").read_text(encoding="utf-8"))
        self.assertIn("НИТЬ «СПАСИ!»", table)
        self.assertLess(page.index('id="for-ai-text-20260929"'), page.index('id="channel-dictionary-title"'))

    def test_abortion_transcription_keeps_both_parts_in_one_last_block(self) -> None:
        relative = "docs/transcriptions/T00040/part_1.md"
        source = (ROOT / relative).read_text(encoding="utf-8")
        context = (ROOT / "docs/transcriptions/T00040/index.md").read_text(encoding="utf-8")
        original = original_transcription(context)
        self.assertIn("Ендерванториум шафектум!", original)
        self.assertIn("Едро! Сефиктим! Невориблеториум! Набожность и суть.", original)
        page = (OUTPUT / "termination-of-pregnancy/index.html").read_text(encoding="utf-8")
        blocks = sos_item_blocks(page)
        self.assertEqual(1, len(blocks))
        field = re.search(r'<textarea\b[^>]*id="termination-text-1"[^>]*>(.*?)</textarea>', blocks[0], re.S)
        self.assertIsNotNone(field, "Нет поля для копирования новой транскрипции")
        self.assertEqual(original, html.unescape(field.group(1)))
        parser = PageParser()
        parser.feed(blocks[0])
        self.assertEqual(["T00040-part_1"], parser.reactions)
        self.assertIn("Разбор транскрипции: 100%", blocks[0])
        self.assertLess(page.index("Любимые мои! - жизнь в муках - не жизнь."), page.index('id="termination-text-1"'))
        self.assertIn('/transcriptions/T00040/part_1/"', blocks[0])
        self.assertIn("Абортированные дети хранятся Богом", author_translation_html(source, BASE_URL))
        self.assertIn("Абортированные дети хранятся Богом", blocks[0])
        entries = json.loads((OUTPUT / "data/entries.json").read_text(encoding="utf-8"))
        matching = [entry for entry in entries if entry["sourceUrl"].endswith("/" + relative)]
        self.assertEqual(1, len(matching))
        self.assertEqual(original, matching[0]["bodyText"])
        self.assertEqual(original, matching[0]["copyText"])
        self.assertEqual("2026-09-30", matching[0]["calendarDate"])
        self.assertEqual("manual", matching[0]["analysisMode"])
        self.assertNotIn("appearanceTime", matching[0])

    def test_dictionary_separates_explicit_fields_without_inventing_missing_values(self) -> None:
        source = '**Едро** — הדר (H1926, «величие, красота, великолепие»).\n- **Двойной смысл:** «ядро» — центр, суть.\n\n**Трактовка автора:** Моя трактовка\n'
        writing, transcription, obtained, glossary, author, language = dictionary_fields('Едро', source)
        self.assertEqual(['הדר'], writing)
        self.assertEqual(['Едро'], transcription)
        self.assertEqual(['ручная'], obtained)
        self.assertEqual(['הדר — величие, красота, великолепие'], glossary)
        self.assertEqual(['Моя трактовка'], author)
        self.assertEqual([], language)
        self.assertEqual([[], ['Неизвестное слово'], ['ручная'], [], [], []], dictionary_fields('Неизвестное слово', '**Значение:** Предположение составителя\n**Смысл:** Образ из разбора'))

        uncertain = '**Корень:** דָּא (арам.)\nлат. -rum (суффикс места)\ngentum (народ)? неуверенно\nτόνος (G5140, «натяжение → тон → тончайшее»)'
        self.assertEqual([], dictionary_fields('Неоднозначный фрагмент', uncertain)[3])

        dictionary_note = 'Словарная гипотеза: иврит `שָׁלוֹם`, мир/благополучие по [BDB](https://biblehub.com/bdb/7965.htm); язык всей молитвы не установлен.'
        self.assertEqual([['שָׁלוֹם'], ['шалом'], ['ручная'], [dictionary_note], [], ['иврит']], dictionary_fields('шалом', dictionary_note))

        explicit = '**Написание:** רוח\n**Транскрипция:** Ру-вах\n**Перевод из словаря:** дух\n**Трактовка автора:** обращение\n'
        self.assertEqual([['רוח'], ['Ру-вах'], ['ручная'], ['дух'], ['обращение'], []], dictionary_fields('Ру-вах', explicit))
        table = dictionary_html('# Словарь\n\n## Едро\n\n' + source, BASE_URL)
        for label in ('Написание', 'транскрипция', 'Транскрипция получена', 'перевод из словаря', 'трактовка автора', 'язык'):
            self.assertIn(f'<th scope="col">{label}</th>', table)
        self.assertIn(markdown_html(source.strip(), BASE_URL), table)
        self.assertIn('<summary>Разборы и источники</summary>', table)

    def test_dictionary_language_reads_named_candidates_without_guessing(self) -> None:
        source = '**Язык:** иврит (гипотеза)\n**Языки:** греческий (гипотеза)\n'
        self.assertEqual(['иврит (гипотеза)', 'греческий (гипотеза)'], dictionary_fields('Слово', source)[5])
        self.assertEqual(['иврит'], dictionary_fields('Слово', '**Иврит:** רוח\n**Японский:** —\n\nВ разборе упомянуты греческий и японский языки')[5])
        self.assertEqual(['латинский', 'греческий'], dictionary_fields('Веритоне', '- **вери** = лат. *vertere* (переворачивать)\n- **тоне** = греч. τόνος (натяжение)')[5])
        self.assertEqual(['греческий', 'русский', 'латинский'], dictionary_fields('Еглочероментоне', '- **егло** = греч. ἐλέγχω\n- **чере** = διά или рус. «через»\n- **ментоне** = лат. *mens* + греч. τόνος')[5])
        self.assertEqual(['аккадский', 'иврит'], dictionary_fields('вери-до', '**Предложение исходника: язык, сопоставление и смысл:** Аккадский/иврит, W-R-D')[5])
        self.assertEqual(['арамейский'], dictionary_fields('тура', '**Значение:** Искать (арамейская форма)')[5])
        self.assertEqual(['иврит', 'японский'], dictionary_fields('Ис-ша', '**Предполагаемый язык:** иврит\n**Предполагаемый язык:** японский')[5])
        self.assertEqual(['английский'], dictionary_fields('енфорсед', '**Кандидат или поправка из переписки:** Возможное созвучие с английским *enforced*')[5])
        self.assertEqual(['русский'], dictionary_fields('Набожность и суть', 'Русские слова. Молитва и сущность.')[5])
        self.assertEqual(['греческий'], dictionary_fields('Холаспис', '**Язык:** греческий\n**Предложение источника:** лат. holo + aspis')[5])
        self.assertEqual([], dictionary_fields('URL', '**Предложение источника:** [Источник](https://example.org/японский)')[5])
        self.assertEqual([], dictionary_fields('Без языка', '**Корень:** רוח\n**Strong:** H7307\n[Hebrew](https://example.org/hebrew)\n**Проверка:** Сопоставление с японским и греческим не выполнено')[5])
        table = dictionary_html('# Словарь\n\n## Слово\n\n' + source, BASE_URL)
        self.assertRegex(table, r'<th scope="col">язык</th></tr></thead>')
        self.assertIn('data-label="язык"><p>иврит (гипотеза)</p>\n<p>греческий (гипотеза)</p></td>', table)

    def test_dictionary_moves_engine_markers_from_transcription_only(self) -> None:
        for engine in ('ZIPA', 'W2V2', 'Allosaurus'):
            with self.subTest(engine=engine):
                source = f'**Точная форма и движок:** `æ n ð eː`, {engine}\n\nУпоминания ZIPA, W2V2 и Allosaurus в разборе'
                columns = dictionary_fields('Заголовок', source)
                self.assertEqual(['`æ n ð eː`'], columns[1])
                self.assertEqual([engine], columns[2])
                table = dictionary_html('# Словарь\n\n## Заголовок\n\n' + source, BASE_URL)
                self.assertIn(f'data-label="Транскрипция получена"><p>{engine}</p></td>', table)
                self.assertIn(markdown_html(source, BASE_URL), table)

        source = '**Транскрипция:** Ру-вах\n\nРазбор сопоставляет ZIPA, W2V2 и Allosaurus'
        self.assertEqual([['Ру-вах'], ['ручная']], dictionary_fields('Заголовок, ZIPA', source)[1:3])
        self.assertEqual([['`d ɛ r v ɛ l`'], ['ZIPA']], dictionary_fields('`d ɛ r v ɛ l`, ZIPA', '')[1:3])

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

    def test_calendar_blocks_match_published_transcription_fields(self) -> None:
        data_dir = OUTPUT / "data"
        entries = json.loads((data_dir / "entries.json").read_text(encoding="utf-8"))
        blocks = json.loads((data_dir / "calendar-transcriptions.json").read_text(encoding="utf-8"))
        purposes = json.loads((data_dir / "transcription-purposes.json").read_text(encoding="utf-8"))
        translations = json.loads((data_dir / "author-translations.json").read_text(encoding="utf-8"))
        expected = [entry for entry in entries if entry.get("published") and entry["type"] in {"manual_transcription", "analysis"}]
        self.assertEqual({entry["sourceUrl"] for entry in expected}, set(blocks))
        for entry in expected:
            with self.subTest(entry=entry["externalKey"]):
                relative = entry["sourceUrl"].split("/blob/main/", 1)[1]
                block = blocks[entry["sourceUrl"]]
                page = OUTPUT / block["pageUrl"].lstrip("/") / "index.html"
                parser = PageParser()
                parser.feed(page.read_text(encoding="utf-8"))
                self.assertEqual(parser.textarea, block["copyText"])
                self.assertEqual(purposes[relative], block["purposeHtml"])
                self.assertEqual(translations[relative], block["translationHtml"])

        help_entry = next(entry for entry in expected if entry["externalKey"] == "T00042-part_1")
        help_block = blocks[help_entry["sourceUrl"]]
        self.assertEqual(help_entry["copyText"], help_block["copyText"])
        self.assertNotEqual(help_entry["bodyText"], help_block["copyText"])

    def test_sitemap_contains_each_page(self) -> None:
        sitemap = (OUTPUT / "sitemap.xml").read_text(encoding="utf-8")
        for page in OUTPUT.rglob("index.html"):
            route = "/" + str(page.parent.relative_to(OUTPUT)).replace("\\", "/").strip("/")
            route = "/" if route == "/." else route.rstrip("/") + "/"
            self.assertIn(f"<loc>{BASE_URL}{route}</loc>", sitemap)

    def test_yandex_verification_is_copied_to_site_root(self) -> None:
        filename = "yandex_1195bbe61e0c2002.html"
        source = ROOT / "site" / "public_html" / filename
        self.assertEqual(source.read_bytes(), (OUTPUT / filename).read_bytes())
        self.assertIn(b"Verification: 1195bbe61e0c2002", source.read_bytes())

    def test_for_ai_uses_source_text_and_separate_purpose(self) -> None:
        relative = "docs/transcriptions/T00035/script14_analysis.md"
        earlier_relative = "docs/transcriptions/T00035/script12_analysis_full.md"
        section = (OUTPUT / "for-ai" / "index.html").read_text(encoding="utf-8")
        transcript = (OUTPUT / transcription_route(ROOT / relative).lstrip("/") / "index.html").read_text(encoding="utf-8")
        earlier_transcript = (OUTPUT / transcription_route(ROOT / earlier_relative).lstrip("/") / "index.html").read_text(encoding="utf-8")
        purpose = "По указанию автора, материалы этой подборки посвящены нейросетям."

        self.assertIn("Все транскрипции здесь посвящены нейросетям", section)
        self.assertIn(purpose, section)
        self.assertIn(purpose, transcript)
        self.assertIn("майлТу(отправка на почту", section)
        self.assertIn("майлТу(отправка на почту", transcript)
        self.assertIn("Бог! Отправка — прямой телец", section)
        self.assertIn("Бог! Отправка — прямой телец", transcript)
        self.assertLess(section.index("25.09.2026 — О настроенном диалоге"), section.index("28.09.2026 — Послание о нейросети"))
        self.assertIn("Ру-ви! Хи-де-ро! У-ще!", section)
        self.assertLess(section.index("28.09.2026 — Послание о нейросети"), section.index("29.09.2026 — Обращение к нейронке"))
        self.assertIn("Элохим! Ру-ви-де!", section)
        self.assertIn("Элохим! Ру-ви-де!", earlier_transcript)
        self.assertIn("Бог! Дух — приди — знай!", section)
        self.assertIn(purpose, earlier_transcript)


if __name__ == "__main__":
    unittest.main()
