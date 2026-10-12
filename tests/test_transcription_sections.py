"""Проверки отделения Markdown-оформления от исходных полей транскрипции."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "site" / "scripts"))
import build_static as build  # noqa: E402
import update_calendar as calendar  # noqa: E402
from transcription_sections import section_markdown, strip_boundary_rule  # noqa: E402


class TranscriptionSectionsTest(unittest.TestCase):
    def test_separators_do_not_enter_raw_or_display_fields(self):
        for wrapper in ("{text}", "> {text}", "```text\n{text}\n```", "~~~text\n{text}\n~~~"):
            with self.subTest(wrapper=wrapper):
                markdown = (
                    "## Исходная транскрипция\n\n" + wrapper.format(text="Ру!") + "\n\n---\n\n"
                    "## Транскрипция для вывода\n\n" + wrapper.format(text="Е!") + "\n\n---\n\n"
                    "## Статус проверки\n\nГипотеза.\n"
                )
                self.assertEqual("Ру!", build.original_transcription(markdown))
                self.assertEqual("Е!", build.transcription_section(markdown, "Текст для копирования"))
                self.assertEqual("Ру!", calendar.source_section(markdown))

    def test_fenced_literals_keep_headings_rules_and_quote_markers(self):
        text = "Ру!\n## Исходная строка внутри кода\n---\n> Это исходные символы\nЕ!"
        for marker in ("```", "````", "~~~"):
            with self.subTest(marker=marker):
                markdown = f"## Исходная транскрипция\n\n{marker}text\n{text}\n{marker}\n\n---\n\n## Пословный разбор\n\nДругое."
                self.assertEqual(text, build.original_transcription(markdown))
                self.assertEqual(text, calendar.source_section(markdown))

    def test_inner_fence_is_literal_with_longer_outer_fence(self):
        text = "Ру!\n```\n## Это исходные символы\n---\n```\nЕ!"
        markdown = f"## Исходная транскрипция\n\n````text\n{text}\n````\n\n---\n\n## Статус проверки\n\nОткрыт."
        self.assertEqual(text, build.original_transcription(markdown))
        self.assertEqual(text, calendar.source_section(markdown))

    def test_internal_plain_rule_is_preserved(self):
        text = "Ру!\n\n---\n\nЕ!"
        markdown = f"## Исходная транскрипция\n\n{text}\n\n---\n\n## Разбор фрагментов\n\nДругой блок."
        self.assertEqual(text, build.original_transcription(markdown))
        self.assertEqual(text, calendar.source_section(markdown))

    def test_unfenced_structural_block_labels_are_not_heard_text(self):
        markdown = (
            "## Исходная транскрипция\n\n**Блок 1 (транскрипция — будущее, к чему ведёт):**\nРу!\n\n"
            "**Блок 2 (молитва — настоящее, просьба к Богу):**\nЕ!\n\n---\n\n## Статус проверки\n\nОткрыт."
        )
        self.assertEqual("Ру!\n\nЕ!", build.original_transcription(markdown))
        self.assertEqual("Ру!\n\nЕ!", calendar.source_section(markdown))
        parts = markdown.replace("**Блок 1 (транскрипция — будущее, к чему ведёт):**", "**Часть 1:**")
        parts = parts.replace("**Блок 2 (молитва — настоящее, просьба к Богу):**", "**Часть 2:**")
        self.assertEqual("Ру!\n\nЕ!", build.original_transcription(parts))
        literal = "**Блок 1:**\nРу!"
        fenced = f"## Исходная транскрипция\n\n```text\n{literal}\n```\n\n---\n\n## Статус проверки\n\nОткрыт."
        self.assertEqual(literal, build.original_transcription(fenced))

    def test_literal_suffix_and_unclosed_fenced_rule_are_preserved(self):
        self.assertEqual("Текст---", strip_boundary_rule("Текст---"))
        self.assertEqual("```text\n---", strip_boundary_rule("```text\n---\n"))
        self.assertEqual("Текст---", build.author_translation_markdown("## Перевод автора\n\nТекст---\n\n## Статус\n\nОткрыт."))

    def test_empty_section_remains_empty_and_missing_section_is_distinct(self):
        markdown = "## Предполагаемое назначение\n\n---\n\n## Исходная транскрипция\n\n---\n\n## Статус проверки\n\nОткрыт."
        self.assertEqual("", section_markdown(markdown, "Назначение"))
        self.assertIsNone(section_markdown(markdown, "Текст для копирования"))
        self.assertEqual("", build.original_transcription(markdown))
        self.assertEqual("", calendar.source_section(markdown))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "T99999.md"
            source.write_text(markdown, encoding="utf-8")
            with patch("build_static.ROOT", root):
                self.assertEqual('<p>Пока не заполнено</p>', build.purpose_html(source))

    def test_purpose_alias_does_not_include_divider_or_next_block(self):
        for heading in ("Предполагаемое назначение", "Назначение"):
            with self.subTest(heading=heading), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "T99999.md"
                source.write_text(f"## {heading}\n\nБлагодарение Бога.\n\n---\n\n## Исходная транскрипция\n\nЕ!", encoding="utf-8")
                with patch("build_static.ROOT", root):
                    self.assertEqual('<p>Благодарение Бога.</p>', build.purpose_html(source))

    def test_coherent_translation_has_priority_over_legacy_word_analysis(self):
        markdown = (
            "## Предполагаемый связный перевод\n\nСвязный текст.\n\n---\n\n"
            "## Пословный разбор\n\n### Перевод автора\n\nЕ! — есть.\n\n---\n\n"
            "## Статус проверки\n\nНе подтверждено."
        )
        self.assertEqual("Связный текст.", build.author_translation_markdown(markdown))
        self.assertEqual("<p>Связный текст.</p>", build.author_translation_html(markdown, build.BASE_URL))

    def test_legacy_translation_h3_fallback_stops_at_next_h3(self):
        markdown = (
            "## Пословный разбор\n\n### Итоговый перевод (прежняя редакция)\n\nЕ! — есть.\n\n---\n\n"
            "### Другой анализ\n\nНе тот перевод.\n\n---\n\n## Статус проверки\n\nОткрыт."
        )
        self.assertEqual("Е! — есть.", build.author_translation_markdown(markdown))

    def test_raw_and_display_are_independent_and_display_symbols_are_unchanged(self):
        raw = "Ру! ⟐ Это часть исходника.\n---\nЕ!"
        displayed = "⟐ Текст для вывода."
        markdown = (
            f"## Исходная транскрипция\n\n```text\n{raw}\n```\n\n---\n\n"
            f"## Транскрипция для вывода\n\n```text\n{displayed}\n```\n\n---\n\n## Автор:\n\nАвтор№1"
        )
        self.assertEqual(raw, build.original_transcription(markdown))
        self.assertEqual(raw, calendar.source_section(markdown))
        self.assertEqual(displayed, build.transcription_section(markdown, "Текст для копирования"))

    def test_canonical_display_overrides_stale_entry_and_inline_copy(self):
        markdown = (
            "## Исходная транскрипция\n\n```text\nРу-ви! ((Пометка автора))\n```\n\n---\n\n"
            "## Транскрипция для вывода\n\n```text\nРу⟐ви!\n```\n\n---\n\n## Статус проверки\n\nГипотеза."
        )
        entry = {"copyText": "Старая копия.", "bodyText": "Исходные архивные данные."}
        self.assertEqual("Ру⟐ви!", build.resolve_copy_text(markdown, entry, "Старое поле."))
        self.assertEqual("Ру-ви! ((Пометка автора))", build.original_transcription(markdown))
        self.assertEqual({"copyText": "Старая копия.", "bodyText": "Исходные архивные данные."}, entry)

    def test_explicit_empty_display_does_not_fall_back_to_stale_text(self):
        markdown = "## Транскрипция для вывода\n\n---\n\n## Исходная транскрипция\n\nРу!"
        self.assertEqual("", build.resolve_copy_text(markdown, {"copyText": "Старое поле."}, "Старая inline копия."))

    def test_legacy_copy_precedence_and_raw_fallback_are_preserved(self):
        markdown = "## Необработанная транскрипция\n\nРу!\n\n## Текст для копирования\n\nЕ!"
        self.assertEqual("Старая явно заданная копия.", build.resolve_copy_text(markdown, {"copyText": "Старая явно заданная копия."}))
        self.assertEqual("Е!", build.resolve_copy_text(markdown, {}))
        self.assertEqual("Ру!", build.resolve_copy_text("## Необработанная транскрипция\n\nРу!", {}))

    def test_inline_display_sync_preserves_controls_and_is_idempotent(self):
        relative = "docs/transcriptions/T99999.md"
        untouched = '<details class="sos-item"><textarea id="placeholder">Без источника</textarea></details>'
        source = (
            '<details class="sos-item"><summary>Заголовок</summary><div>'
            '<textarea id="copy" readonly rows="4">Старая копия</textarea>'
            f'<a href="{build.SOURCE_URL}{relative}">Подробнее</a>'
            '<button data-copy-target="copy">Скопировать</button></div></details>' + untouched
        )
        displayed = "Ру⟐ви! <слово> & смысл\nЕ!"
        result = build.synchronize_copy_fields(source, {relative: displayed})
        self.assertEqual(displayed, build.copy_texts(result)[relative])
        self.assertIn('<textarea id="copy" readonly rows="4">', result)
        self.assertIn('<button data-copy-target="copy">Скопировать</button>', result)
        self.assertIn(untouched, result)
        self.assertNotIn("Старая копия", result)
        self.assertEqual(result, build.synchronize_copy_fields(result, {relative: displayed}))

    def test_inline_alias_keeps_known_key_when_display_changes(self):
        relative = "docs/transcriptions/T99999.md"
        key = "T99999"
        source = (
            '<details class="sos-item"><summary>Повторная карточка</summary><div>'
            '<textarea id="legacy-copy" readonly>Прежний текст без ссылки</textarea>'
            f'<div data-transcription-reaction="{key}" data-reaction-title="Повторная карточка"></div>'
            '</div></details>'
        )
        keys = {relative: key}
        texts = {relative: "Новый⟐текст"}
        first, first_keys = build.attach_block_reactions(source, keys, texts)
        self.assertEqual({key}, first_keys)
        self.assertEqual(1, first.count(f'data-transcription-reaction="{key}"'))
        synchronized = build.synchronize_copy_fields(first, texts, keys)
        self.assertIn('>Новый⟐текст</textarea>', synchronized)
        second, second_keys = build.attach_block_reactions(synchronized, keys, texts)
        self.assertEqual({key}, second_keys)
        self.assertEqual(synchronized, second)
        with self.assertRaisesRegex(ValueError, "Не задан постоянный ключ"):
            build.attach_block_reactions(source.replace(key, "T88888"), keys, texts)

    def test_new_comments_include_word_table_but_not_status(self):
        words = "| Слово | Значение |\n| --- | --- |\n| Е! | Есть |"
        markdown = (
            f"## Пословный разбор\n\n{words}\n\n---\n\n"
            "## Комментарии и варианты\n\nКомментарий автора.\n\n---\n\n## Статус проверки\n\nНе подтверждено."
        )
        self.assertEqual(words + "\n\nКомментарий автора.", build.commentary_markdown(markdown))
        legacy = (
            "## Комментарии и варианты\n\n### Комментарий к обращению\n\nПрежний комментарий.\n\n---\n\n"
            "### Вариант отдельно\n\nДругой материал."
        )
        self.assertEqual("Прежний комментарий.", build.commentary_markdown(legacy))

    def test_ai_overview_accepts_new_headings_and_nested_legacy_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            relative = "docs/transcriptions/T99999.md"
            source = root / relative
            source.parent.mkdir(parents=True)
            source.write_text(
                "# §T99999 — Проверка\n\n## Сведения о транскрипции\n\n"
                "- Дата и время получения транскрипции: 11.10.2026, 12:34 МСК.\n\n---\n\n"
                "## Предполагаемое назначение\n\nТема.\n\n---\n\n"
                "## Исходная транскрипция\n\n```text\nРу!\n```\n\n---\n\n"
                "## Предполагаемый связный перевод\n\nПеревод.\n\n---\n\n"
                "## Комментарии и варианты\n\n### Якоря для нейронки\n\nСверить.\n\n---\n\n"
                "## Автор:\n\nАвтор№1",
                encoding="utf-8",
            )
            panel = ('<details class="sos-item"><summary>Проверка</summary>'
                     f'<div class="author-translation-body" data-author-translation="{relative}"></div></details>')
            with patch("build_static.ROOT", root):
                result = build.ai_page_markdown(panel, {}, {relative: "⟐ Для вывода."})
            self.assertIn("### Purpose (proposed)\n\nТема.", result)
            self.assertIn("### Proposed translation\n\nПеревод.", result)
            self.assertIn("### Notes for AI\n\nСверить.", result)
            self.assertIn("```text\nРу!\n```", result)
            self.assertIn("```text\n⟐ Для вывода.\n```", result)
            self.assertNotIn("\n---\n", result)


if __name__ == "__main__":
    unittest.main()
