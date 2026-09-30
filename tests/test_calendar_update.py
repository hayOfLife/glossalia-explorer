"""Focused checks for adding new transcription files to the calendar."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "site" / "scripts" / "update_calendar.py"
SPEC = importlib.util.spec_from_file_location("update_calendar", SCRIPT)
calendar = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(calendar)


class CalendarUpdateTest(unittest.TestCase):
    def test_source_section_preserves_multiple_paragraphs(self):
        text = "## Исходная строка\n\nПервая строка\n\nВторая строка\n\n---\n\n## Разбор\n\nПояснение\n"
        self.assertEqual(calendar.source_section(text), "Первая строка\n\nВторая строка")

    def test_source_section_preserves_both_thanksgiving_parts(self):
        source = SCRIPT.parents[2] / "docs/transcriptions/T00027/part_8.md"
        body = calendar.source_section(source.read_text(encoding="utf-8"))
        self.assertIn("Елохим! Едро! Ше!", body)
        self.assertIn("Еглочероментоне! Едро! Фиктим! Елохим! Спасибо!", body)
        self.assertNotIn("##", body)

    def test_adds_new_file_with_source_date_and_preserves_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcripts = root / "docs" / "transcriptions"
            transcripts.mkdir(parents=True)
            source = transcripts / "T99999.md"
            source.write_text(
                "# §T99999 — Новый текст\n\n"
                "- Дата и время получения транскрипции: 24.09.2026, 01:12\n\n"
                "## Необработанная транскрипция\n\n```text\nРу! Вахи!\n```\n",
                encoding="utf-8",
            )
            snapshot = root / "entries.json"
            snapshot.write_text("[]\n", encoding="utf-8")
            index = root / "calendar-index.json"
            index.write_text('{"knownFiles": []}\n', encoding="utf-8")

            with patch.multiple(calendar, REPOSITORY=root, TRANSCRIPTIONS=transcripts, SNAPSHOT=snapshot, INDEX=index):
                self.assertEqual(calendar.update_new_files(), 1)
                self.assertEqual(calendar.update_new_files(), 0)

            entry = json.loads(snapshot.read_text(encoding="utf-8"))[0]
            self.assertEqual(entry["calendarDate"], "2026-09-24")
            self.assertEqual(entry["appearanceTime"], "01:12")
            self.assertEqual(entry["bodyText"], "Ру! Вахи!")
            self.assertEqual(source.read_text(encoding="utf-8").count("Ру! Вахи!"), 1)

    def test_missing_source_date_does_not_change_snapshot_or_index(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcripts = root / "docs" / "transcriptions"
            transcripts.mkdir(parents=True)
            (transcripts / "T99999.md").write_text(
                "# §T99999 — Новый текст\n\n"
                "- Дата и время получения транскрипции: неизвестна; файл предоставлен 29.09.2026\n\n"
                "## Необработанная транскрипция\n\nРу! Вахи!\n",
                encoding="utf-8",
            )
            snapshot = root / "entries.json"
            snapshot.write_text("[]\n", encoding="utf-8")
            index = root / "calendar-index.json"
            index.write_text('{"knownFiles": []}\n', encoding="utf-8")

            with patch.multiple(calendar, REPOSITORY=root, TRANSCRIPTIONS=transcripts, SNAPSHOT=snapshot, INDEX=index):
                with self.assertRaisesRegex(ValueError, "дата появления не установлена"):
                    calendar.update_new_files()

            self.assertEqual(snapshot.read_text(encoding="utf-8"), "[]\n")
            self.assertEqual(json.loads(index.read_text(encoding="utf-8")), {"knownFiles": []})

    def test_dated_analysis_keeps_distinct_identity_and_source_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcripts = root / "docs" / "transcriptions"
            folder = transcripts / "T99999"
            folder.mkdir(parents=True)
            source = folder / "script14_analysis.md"
            source.write_text(
                "# Скрипт 14 — Разбор\n\n**Дата:** 29 сентября 2026, 18 тишрея 5787\n\n"
                "## Исходная строка\n\nЕлохим! Фа!\n\n## Перевод (гипотеза)\n\nТекст разбора.\n",
                encoding="utf-8",
            )

            with patch.multiple(calendar, REPOSITORY=root, TRANSCRIPTIONS=transcripts):
                entry = calendar.entry_from_file("docs/transcriptions/T99999/script14_analysis.md")

            self.assertEqual(entry["calendarDate"], "2026-09-29")
            self.assertEqual(entry["externalKey"], "T99999-script14_analysis")
            self.assertEqual(entry["bodyText"], "Елохим! Фа!")
            self.assertIn("время получения транскрипции не указано", entry["dateNote"])


if __name__ == "__main__":
    unittest.main()
