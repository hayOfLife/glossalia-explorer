"""Add newly published transcription files to the static calendar snapshot."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import quote


REPOSITORY = Path(__file__).resolve().parents[2]
TRANSCRIPTIONS = REPOSITORY / "docs" / "transcriptions"
SNAPSHOT = REPOSITORY / "site" / "public_html" / "data" / "entries.json"
INDEX = REPOSITORY / "site" / "calendar-index.json"
SOURCE_BASE = "https://github.com/hayOfLife/glossalia-explorer/blob/main/"
DATE_RE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)")
RUSSIAN_MONTH_NAMES = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)
RUSSIAN_DATE_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})\s+({'|'.join(RUSSIAN_MONTH_NAMES)})\s+(\d{{4}})(?!\d)",
    re.IGNORECASE,
)
RUSSIAN_MONTHS = {name: number for number, name in enumerate(RUSSIAN_MONTH_NAMES, 1)}
TIME_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)")


def transcription_paths() -> list[str]:
    return [path.relative_to(REPOSITORY).as_posix() for path in sorted(TRANSCRIPTIONS.rglob("*.md"))]


def source_section(text: str) -> str:
    match = re.search(r"^## (?:Необработанная транскрипция|Исходная строка)\s*$", text, re.MULTILINE)
    if not match:
        raise ValueError("нет раздела «Необработанная транскрипция» или «Исходная строка»")

    section = re.split(r"^##\s", text[match.end():], maxsplit=1, flags=re.MULTILINE)[0].strip()
    fenced = re.search(r"^```[^\n]*\n(.*?)^```", section, re.MULTILINE | re.DOTALL)
    if fenced:
        return fenced.group(1).strip()

    lines = section.splitlines()
    quoted = [line.removeprefix(">").strip() for line in lines if line.startswith(">")]
    if quoted:
        return "\n".join(quoted).strip()

    return section.split("\n\n", 1)[0].strip()


def entry_from_file(relative_path: str) -> dict:
    path = (REPOSITORY / relative_path).resolve()
    if not path.is_relative_to(TRANSCRIPTIONS) or path.suffix.lower() != ".md" or path.name == "index.md":
        raise ValueError(f"Недопустимый файл транскрипции: {relative_path}")

    text = path.read_text(encoding="utf-8-sig")
    heading = re.search(r"^# (.+)$", text, re.MULTILINE)
    metadata = re.search(r"^[-*]?\s*Дата и время получения транскрипции:\s*(.+)$", text, re.MULTILINE)
    analysis_date = metadata is None
    if analysis_date:
        metadata = re.search(r"^\*\*Дата:\*\*\s*(.+)$", text, re.MULTILINE)
    if not heading or not metadata:
        raise ValueError(f"{relative_path}: нужны заголовок и дата")

    appearance_note = re.split(r"файл предоставлен|загружен|дата разбора|анализ выполнен", metadata.group(1), maxsplit=1, flags=re.IGNORECASE)[0]
    date = DATE_RE.search(appearance_note)
    russian_date = RUSSIAN_DATE_RE.search(appearance_note) if not date else None
    if not date and not russian_date:
        raise ValueError(f"{relative_path}: дата появления не установлена; запись нельзя поставить в календарь")

    if date:
        day, month, year = map(int, date.groups())
    else:
        day = int(russian_date.group(1))
        month = RUSSIAN_MONTHS[russian_date.group(2).lower()]
        year = int(russian_date.group(3))
    from datetime import date as calendar_date

    calendar_day = calendar_date(year, month, day).isoformat()
    time = TIME_RE.search(appearance_note)
    if time and (int(time.group(1)) > 23 or int(time.group(2)) > 59):
        raise ValueError(f"{relative_path}: некорректное время появления")

    body = source_section(text)
    if not body or body.lower().startswith(("не предостав", "неизвест")):
        raise ValueError(f"{relative_path}: нет исходной строки транскрипции")

    tag = re.search(r"T\d{5}", path.as_posix())
    if not tag:
        raise ValueError(f"{relative_path}: не найден тег транскрипции")

    title = re.sub(r"^§?T\d{5}\s*[—:-]?\s*", "", heading.group(1)).strip()
    entry = {
        "externalKey": f"{tag.group(0)}-{path.stem}" if path.parent != TRANSCRIPTIONS else tag.group(0),
        "type": "analysis",
        "title": title,
        "group": "Разбор транскрипции",
        "calendarDate": calendar_day,
        "dateNote": ("Дата в разборе: " if analysis_date else "") + metadata.group(1).strip() + ("; время получения транскрипции не указано." if analysis_date else ""),
        "bodyText": body,
        "sourceUrl": SOURCE_BASE + quote(path.relative_to(REPOSITORY).as_posix(), safe="/"),
        "statusNote": "Предложенный разбор не является подтверждённым переводом.",
        "published": True,
    }
    if time:
        entry["appearanceTime"] = f"{int(time.group(1)):02d}:{time.group(2)}"

    return entry


def update(paths: list[str], check: bool = False) -> int:
    entries = json.loads(SNAPSHOT.read_text(encoding="utf-8-sig"))
    source_urls = {entry["sourceUrl"] for entry in entries}
    added = 0

    for relative_path in paths:
        if not relative_path.endswith(".md") or Path(relative_path).name == "index.md":
            continue

        url = SOURCE_BASE + quote(Path(relative_path).as_posix(), safe="/")
        if url in source_urls:
            continue

        entry = entry_from_file(relative_path)
        entries.append(entry)
        source_urls.add(url)
        added += 1

    if not added:
        return 0

    entries.sort(key=lambda entry: (entry["calendarDate"], entry.get("appearanceTime") is None, entry.get("appearanceTime", "")))
    if check:
        raise ValueError(f"Календарь не обновлён: {added} новых записей")

    SNAPSHOT.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return added


def update_new_files(check: bool = False) -> int:
    if not INDEX.exists():
        raise ValueError("Нет site/calendar-index.json; сначала задайте список уже учтённых файлов")

    known = set(json.loads(INDEX.read_text(encoding="utf-8"))["knownFiles"])
    current = set(transcription_paths())
    new_paths = sorted(current - known)
    added = update(new_paths, check)
    if new_paths and not check:
        INDEX.write_text(json.dumps({"knownFiles": sorted(current)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return added


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--initialize", action="store_true", help="Запомнить существующие файлы без добавления карточек")
    args = parser.parse_args()
    if args.initialize:
        if INDEX.exists():
            parser.error("calendar-index.json уже существует")
        INDEX.write_text(json.dumps({"knownFiles": transcription_paths()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return

    print(f"Новых записей календаря: {update(args.paths, args.check) if args.paths else update_new_files(args.check)}")


if __name__ == "__main__":
    main()
