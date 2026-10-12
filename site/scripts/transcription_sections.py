"""Извлечение смысловых блоков транскрипции без разделителей оформления."""

from __future__ import annotations

import re
from collections.abc import Iterator, Sequence


SECTION_ALIASES = {
    "Назначение": ("Предполагаемое назначение", "Назначение"),
    "Необработанная транскрипция": ("Исходная транскрипция", "Необработанная транскрипция"),
    "Исходная строка": ("Исходная транскрипция", "Исходная строка"),
    "Текст для копирования": ("Транскрипция для вывода", "Текст для копирования"),
    "Комментарий к обращению": ("Комментарии и варианты", "Комментарий к обращению"),
}
TRANSLATION_HEADINGS = (
    "Предполагаемый связный перевод", "Перевод автора", "Авторский перевод",
    "Сводный перевод Автор№1", "Итоговый перевод", "Связный перевод",
    "Перевод (гипотеза)", "Всё послание связным текстом",
)
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
BLOCK_LABEL = re.compile(r"^\*\*(?:Блок\s+\d+(?:\s*\([^\n]*\))?|Часть\s+\d+)\s*:\*\*$", re.I)


def outside_fence_lines(markdown: str) -> Iterator[tuple[int, str, bool]]:
    """Вернуть смещения строк вне блоков кода и их открывающих границ."""
    marker = ""
    length = 0
    offset = 0
    for line in markdown.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        fence = FENCE.match(body)
        inside = bool(marker)
        if fence:
            run, suffix = fence.groups()
            if marker:
                if run[0] == marker and len(run) >= length and not suffix.strip():
                    marker = ""
            elif run[0] != "`" or "`" not in suffix:
                marker = run[0]
                length = len(run)
        if not inside:
            yield offset, line, bool(marker)
        offset += len(line)


def strip_boundary_rule(content: str) -> str:
    """Убрать только конечный разделитель вне кода, сохраняя внутренние строки."""
    content = content.strip()
    last = content.rfind("\n") + 1
    if re.fullmatch(r"[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*", content[last:]):
        for offset, line, opens_fence in outside_fence_lines(content):
            if offset == last and not opens_fence:
                return content[:last].rstrip()
    return content


def section_markdown(markdown: str, headings: str | Sequence[str], *, levels: tuple[int, ...] = (2,),
                     parenthetical: bool = False) -> str | None:
    """Вернуть первый подходящий блок по приоритету имён; None означает отсутствие."""
    if isinstance(headings, str):
        headings = SECTION_ALIASES.get(headings, (headings,))
    found = []
    for offset, line, opens_fence in outside_fence_lines(markdown):
        heading = HEADING.match(line.rstrip("\r\n")) if not opens_fence else None
        if heading:
            found.append((len(heading.group(1)), heading.group(2), offset, offset + len(line)))
    for wanted in headings:
        for index, (level, title, start, end) in enumerate(found):
            if level not in levels:
                continue
            matches = title.casefold() == wanted.casefold()
            if parenthetical:
                matches = matches or title.casefold().startswith(wanted.casefold() + " (")
            if not matches:
                continue
            boundary = next((offset for following_level, _, offset, _ in found[index + 1:]
                             if following_level <= level), len(markdown))
            return strip_boundary_rule(markdown[end:boundary])
    return None


def transcription_text(markdown: str, heading: str | Sequence[str]) -> str:
    """Снять внешний блок кода или маркеры цитаты с исходного текста."""
    section = section_markdown(markdown, heading)
    if section is None:
        return ""
    lines = section.splitlines()
    opening = FENCE.match(lines[0]) if lines else None
    if opening:
        marker = opening.group(1)
        lines = lines[1:]
        if lines and re.fullmatch(rf" {{0,3}}{re.escape(marker[0])}{{{len(marker)},}}[ \t]*", lines[-1]):
            lines = lines[:-1]
    else:
        outside = {offset for offset, _, opens_fence in outside_fence_lines(section) if not opens_fence}
        offset = 0
        cleaned = []
        for line in section.splitlines(keepends=True):
            content = line.rstrip("\r\n")
            if offset in outside:
                content = re.sub(r'^\s*>\s?', '', content)
                if BLOCK_LABEL.fullmatch(content.strip()):
                    offset += len(line)
                    continue
            cleaned.append(content)
            offset += len(line)
        lines = cleaned
    return "\n".join(lines).strip()
