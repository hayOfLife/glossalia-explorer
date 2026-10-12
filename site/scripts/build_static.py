"""Собрать отдельные HTML-страницы из текущей оболочки и исходных Markdown."""

from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import zipfile
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

from transcription_sections import TRANSLATION_HEADINGS, section_markdown, transcription_text


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "site" / "public_html"
OUTPUT = ROOT / "site" / "build"
BASE_URL = "https://glossalia-explorer.tuqo.ru"
TRANSCRIPTION_REDIRECTS = {
    "docs/transcriptions/T00014.md": "docs/transcriptions/T00032/part_1.md",
    "docs/transcriptions/T00028.md": "docs/transcriptions/T00027/part_5.md",
    "docs/transcriptions/T00029.md": "docs/transcriptions/T00027/part_6.md",
    "docs/transcriptions/T00032.md": "docs/transcriptions/T00032/part_2.md",
}

ROUTES = {
    "about": "/",
    "news": "/news/",
    "today": "/calendar/",
    "situations": "/situations/",
    "situation-1": "/situations/glossolalia/",
    "sos": "/sos/",
    "situation-3": "/situations/help/",
    "termination-of-pregnancy": "/termination-of-pregnancy/",
    "situation-5": "/situations/agnosticism/",
    "situation-6": "/situations/life-partner/",
    "situation-7": "/situations/mental-health/",
    "situation-8": "/situations/divine-guidance/",
    "situation-9": "/situations/occultism-support/",
    "situation-10": "/situations/temple-offering/",
    "translation": "/translation/",
    "article-transcription-analyses": "/transcription-analyses/",
    "dictionary-words": "/dictionaries/words/",
    "dictionary-suffixes": "/dictionaries/suffixes-and-particles/",
    "help": "/help/",
    "help-glossolalia": "/help/glossolalia/",
    "help-purpose": "/help/purpose/",
    "help-churches": "/help/churches/",
    "help-theories": "/help/theories/",
    "help-library": "/help/library/",
    "article-why-god-is-lord": "/articles/why-god-is-lord/",
    "article-glossolalia-hypothesis": "/articles/glossolalia-hypothesis/",
    "article-lurianic-soul-integrity": "/articles/lurianic-kabbalah-soul-integrity/",
    "article-glossolalia-kabbalah-common-points": "/articles/glossolalia-kabbalah-common-points/",
    "article-self-writing-generative-archive": "/articles/self-writing-generative-archive/",
    "article-latin-greek-process-morphology": "/articles/latin-greek-process-morphology/",
    "article-transcription-notes": "/articles/transcription-notes/",
    "article-hebrew-russian-sounds": "/articles/hebrew-russian-sounds/",
    "article-author-term-definitions": "/articles/author-term-definitions/",
    "article-channel-abbreviations": "/articles/channel-abbreviations/",
    "article-transcription-symbol-systems": "/articles/transcription-symbol-systems/",
    "article-transcription-symbols-print": "/articles/transcription-symbols-print/",
    "help-ai": "/help/ai/",
    "help-author": "/help/author/",
    "help-eugenics": "/help/eugenics-vs-genetic-engineering/",
    "donate": "/donate/",
    "for-ai": "/for-ai/",
}
PANEL = re.compile(r'<section class="content-panel[^\"]*" id="([^\"]+)"[^>]*>.*?</section>', re.S)
LOCAL_LINK = re.compile(r'href="#([a-z0-9-]+)"')
SOURCE_URL = "https://github.com/hayOfLife/glossalia-explorer/blob/main/"
PUBLISHED_LINK = re.compile(r'href="https://github\.com/hayOfLife/glossalia-explorer/blob/main/(docs/transcriptions/[^"]+\.md)"')
AUTHOR_TRANSLATION = re.compile(r'<div class="author-translation-body" data-author-translation="([^"]*)"></div>')
PURPOSE_PLACEHOLDER = re.compile(r'<div class="transcription-purpose-body" data-purpose-source="([^"]*)"></div>')
DOCUMENT_PLACEHOLDER = re.compile(r'<div class="help-page" data-document-source="([^"]*)"></div>')
REACTION_PLACEHOLDER = re.compile(r'<div data-transcription-reaction="[^"]+" data-reaction-title="[^"]*"></div>')
CHAT_PLACEHOLDER = re.compile(r'<div(?=[^>]*\bdata-transcription-chat="([^"]+)")(?=[^>]*\bhidden\b)[^>]*>\s*</div>')
CHAT_TEMPLATE = re.compile(r'<template\b[^>]*\bid="transcription-chat-template"[^>]*>\s*(.*?)\s*</template>', re.S)


def digest_file(path: Path) -> str:
    data = path.read_bytes()
    if path.suffix.lower() in {".css", ".html", ".js", ".json", ".md", ".py", ".svg", ".txt"}:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def page_path(route: str) -> Path:
    return OUTPUT / route.lstrip("/") / "index.html"


def html_document(source: str, panel: str, panel_id: str, title: str, description: str, route: str, markdown_route: str = "") -> str:
    matches = list(PANEL.finditer(source))
    if not matches:
        raise ValueError("Не найдены секции сайта")

    page = source[: matches[0].start()] + panel + source[matches[-1].end() :]
    page = page.replace('<body>', f'<body data-page-id="{panel_id}">', 1)
    page_title_match = re.search(r'\bdata-page-title="([^"]+)"', panel.split(">", 1)[0])
    page_title = html.unescape(page_title_match.group(1)) if page_title_match else f"{title} — Глоссалия"
    page = re.sub(r'<title>.*?</title>', f'<title>{html.escape(page_title)}</title>', page, count=1)
    page = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{html.escape(description, quote=True)}">', page, count=1)
    canonical = f'{BASE_URL}{route}'
    page = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{html.escape(page_title, quote=True)}">', page, count=1)
    page = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{html.escape(description, quote=True)}">', page, count=1)
    page = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{canonical}">', page, count=1)
    page = page.replace('</head>', f'    <link rel="canonical" href="{canonical}">\n  </head>', 1)
    if markdown_route:
        page = page.replace('</head>', f'    <link rel="alternate" type="text/markdown" href="{markdown_route}">\n  </head>', 1)
    page = LOCAL_LINK.sub(lambda match: f'href="{ROUTES[match.group(1)]}"' if match.group(1) in ROUTES else match.group(0), page)
    page = re.sub(r'(?<=[=" ])(assets/|data/)', r'/\1', page)
    page = page.replace('class="content-panel"', 'class="content-panel is-active"', 1)
    page = re.sub(r'class="section-link(?: is-active)?', 'class="section-link', page)
    page = re.sub(r' aria-current="page"', '', page)
    return page


def inline(text: str, source_url: str = SOURCE_URL) -> str:
    escaped = html.escape(text)
    escaped = re.sub(r'\[([^]]+)\]\(([^)]+)\)', lambda match: f'<a href="{html.escape(source_link(html.unescape(match.group(2)), source_url), quote=True)}">{match.group(1)}</a>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', escaped)
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    return escaped


def source_link(target: str, source_url: str) -> str:
    if target.startswith(("https://", "http://", "#")):
        return target
    resolved = urljoin(source_url, quote(target))
    return resolved if urlparse(resolved).scheme == "https" else "#"


def plain_document_html(text: str) -> str:
    blocks = re.split(r"\n\s*\n", text.replace("\r\n", "\n").strip())
    result = []
    for block in blocks:
        tag = "h3" if re.fullmatch(r"Раздел \d+\.[^\n]+", block) else "p"
        content = html.escape(block).replace("\n", "<br>\n")
        result.append(f"<{tag}>{content}</{tag}>")
    return "\n".join(result)


def markdown_table(lines: list[str], source_url: str, literal: bool = False) -> str:
    rows = [[cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip()[1:-1])] for line in lines]
    if len(rows) < 2 or not rows[0] or not all(len(row) == len(rows[0]) for row in rows):
        return '<pre class="source-table">' + html.escape("\n".join(lines)) + "</pre>"
    if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1]):
        return '<pre class="source-table">' + html.escape("\n".join(lines)) + "</pre>"

    def cells(row: list[str], tag: str) -> str:
        scope = ' scope="col"' if tag == "th" else ""
        values = [cell.replace(r'\|', '|') for cell in row]
        content = [html.escape(html.unescape(cell)) if literal else inline(cell, source_url) for cell in values]
        return "<tr>" + "".join(f"<{tag}{scope}>{cell}</{tag}>" for cell in content) + "</tr>"

    head = cells(rows[0], "th")
    body = "".join(cells(row, "td") for row in rows[2:])
    return f'<div class="source-table-wrap"><table class="source-table"><thead>{head}</thead><tbody>{body}</tbody></table></div>'


def nested_lists_html(lines: list[str], source_url: str) -> str:
    items = []
    for line in lines:
        expanded = line.expandtabs(4)
        stripped = expanded.strip()
        ordered = re.match(r'^(\d{1,9})[.)]\s+(.+)$', stripped)
        indent = len(expanded) - len(expanded.lstrip())
        items.append((indent, "ol" if ordered else "ul", int(ordered.group(1)) if ordered else None,
                      ordered.group(2) if ordered else stripped[2:]))

    def render_level(index: int) -> tuple[str, int]:
        indent, kind, number, _ = items[index]
        start = f' start="{number}"' if number is not None and number != 1 else ""
        result = [f"<{kind}{start}>"]
        while index < len(items) and items[index][0] == indent and items[index][1] == kind:
            _, _, number, content = items[index]
            value = f' value="{number}"' if number is not None else ""
            item = f"<li{value}>" + inline(content, source_url)
            index += 1
            while index < len(items) and items[index][0] > indent:
                children, index = render_level(index)
                item += "\n" + children
            result.append(item + "</li>")
        result.append(f"</{kind}>")
        return "\n".join(result), index

    result = []
    index = 0
    while index < len(items):
        block, index = render_level(index)
        result.append(block)
    return "\n".join(result)


def markdown_html(text: str, source_url: str, literal_tables: bool = False, nested_lists: bool = False) -> str:
    """Преобразовать обычные блоки Markdown, оставляя сложные таблицы без потери текста."""
    text = re.sub(r"^разбор транскрипции: (?:авто|не требуется|ручной, 100%|(?:100|[1-9]?\d)%)\s*\n", "", text, count=1)
    result: list[str] = []
    paragraph: list[str] = []
    listing = ""
    fence = 0
    fence_lines: list[str] = []
    table: list[str] = []
    nested_listing: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            result.append("<p>" + inline(" ".join(paragraph), source_url) + "</p>")
            paragraph.clear()

    def flush_table() -> None:
        if table:
            result.append(markdown_table(table, source_url, literal=literal_tables))
            table.clear()

    def flush_fence() -> None:
        content = "\n".join(fence_lines) + ("\n" if fence_lines else "")
        result.append("<pre><code>" + html.escape(content) + "</code></pre>")
        fence_lines.clear()

    def flush_nested_listing() -> None:
        if nested_listing:
            result.append(nested_lists_html(nested_listing, source_url))
            nested_listing.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if nested_lists and not fence:
            if re.match(r'^(\d{1,9})[.)]\s+.+$', stripped) or stripped.startswith(("- ", "* ")):
                flush_paragraph()
                flush_table()
                nested_listing.append(line)
                continue
            flush_nested_listing()
        if fence:
            if re.fullmatch(rf'`{{{fence},}}', stripped):
                flush_fence()
                fence = 0
            else:
                fence_lines.append(line)
            continue
        opening_fence = re.fullmatch(r'(`{3,})([^`]*)', stripped)
        if opening_fence:
            flush_paragraph()
            flush_table()
            if listing:
                result.append(f"</{listing}>")
                listing = ""
            fence = len(opening_fence.group(1))
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            if listing:
                result.append(f"</{listing}>")
                listing = ""
            table.append(line)
            continue
        flush_table()
        if not stripped:
            flush_paragraph()
            if listing:
                result.append(f"</{listing}>")
                listing = ""
            continue
        heading = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if heading:
            flush_paragraph()
            if listing:
                result.append(f"</{listing}>")
                listing = ""
            level = min(len(heading.group(1)) + 1, 6)
            result.append(f'<h{level}>{inline(heading.group(2), source_url)}</h{level}>')
            continue
        if re.fullmatch(r'-{3,}|\*{3,}', stripped):
            flush_paragraph()
            if listing:
                result.append(f"</{listing}>")
                listing = ""
            result.append("<hr>")
            continue
        ordered = re.match(r'^(\d{1,9})[.)]\s+(.+)$', stripped)
        if ordered or stripped.startswith(("- ", "* ")):
            flush_paragraph()
            kind = "ol" if ordered else "ul"
            if listing != kind:
                if listing:
                    result.append(f"</{listing}>")
                start = f' start="{int(ordered.group(1))}"' if ordered and int(ordered.group(1)) != 1 else ""
                result.append(f"<{kind}{start}>")
                listing = kind
            value = f' value="{int(ordered.group(1))}"' if ordered else ""
            content = ordered.group(2) if ordered else stripped[2:]
            result.append(f"<li{value}>" + inline(content, source_url) + "</li>")
            continue
        if listing:
            result.append(f"</{listing}>")
            listing = ""
        if stripped == ">":
            flush_paragraph()
            continue
        if stripped.startswith("> "):
            flush_paragraph()
            result.append("<blockquote>" + inline(stripped[2:], source_url) + "</blockquote>")
            continue
        paragraph.append(stripped)

    flush_nested_listing()
    flush_paragraph()
    flush_table()
    if listing:
        result.append(f"</{listing}>")
    if fence:
        flush_fence()
    return "\n".join(result)


def transcription_route(source_path: Path) -> str:
    relative = source_path.relative_to(ROOT / "docs" / "transcriptions")
    return "/transcriptions/" + "/".join(relative.with_suffix("").parts) + "/"


def sos_item_blocks(source: str) -> list[str]:
    blocks = []
    start = None
    depth = 0
    for tag in re.finditer(r'<(/?)details\b[^>]*>', source, re.I):
        if tag.group(1):
            if start is not None:
                depth -= 1
                if depth == 0:
                    blocks.append(source[start:tag.end()])
                    start = None
        elif start is not None:
            depth += 1
        elif re.search(r'class="sos-item"', tag.group(0)):
            start = tag.start()
            depth = 1
    return blocks


def copy_texts(source: str) -> dict[str, str]:
    result = {}
    for block in sos_item_blocks(source):
        link = PUBLISHED_LINK.search(block)
        translation = AUTHOR_TRANSLATION.search(block)
        field = re.search(r'<textarea[^>]*>(.*?)</textarea>', block, re.S)
        relative = link.group(1) if link else translation.group(1) if translation else ""
        if relative and field:
            result[relative] = html.unescape(field.group(1))
    return result


def synchronize_copy_fields(source: str, texts: dict[str, str], keys: dict[str, str] | None = None) -> str:
    key_sources = {key: relative for relative, key in (keys or {}).items()}
    for block in sos_item_blocks(source):
        link = PUBLISHED_LINK.search(block)
        translation = AUTHOR_TRANSLATION.search(block)
        relative = link.group(1) if link else translation.group(1) if translation else ""
        previous = re.search(r'data-transcription-reaction="([^"]+)"', block)
        if not relative and previous:
            relative = key_sources.get(previous.group(1), "")
        field = re.search(r'(<textarea\b[^>]*>)(.*?)(</textarea>)', block, re.S)
        if relative in texts and field:
            replacement = field.group(1) + html.escape(texts[relative], quote=False) + field.group(3)
            source = source.replace(block, block.replace(field.group(0), replacement, 1), 1)
    return source


def attach_acquisition_icons(source: str, types: dict[str, str]) -> str:
    for block in sos_item_blocks(source):
        if not re.search(r'<textarea\b', block):
            continue

        link = PUBLISHED_LINK.search(block)
        binding = re.search(r'data-analysis-source="([^"]*)"', block)
        relative = link.group(1) if link else binding.group(1) if binding else ""
        summary = re.search(r'<summary>(.*?)</summary>', block, re.S)
        if not summary:
            continue

        title = re.sub(r'<span class="transcription-acquisition"[^>]*>.*?</span>', '', summary.group(1), flags=re.S)
        title = re.sub(r'<span class="transcription-heading">(.*?)</span>', r'\1', title, flags=re.S)
        heading = f'<summary><span class="transcription-heading">{title}</span>{acquisition_icon(types.get(relative, "written"))}</summary>'
        source = source.replace(block, block.replace(summary.group(0), heading, 1), 1)
    return source


def reaction_key(relative: str, entry: dict | None = None) -> str:
    previous = (entry or {}).get("externalKey", "")
    if re.fullmatch(r"T\d{5}(?:-[A-Za-z0-9_-]{1,100})?", previous):
        return previous

    path = Path(relative).relative_to("docs/transcriptions").with_suffix("")
    tag = path.parts[0]
    slug = "-".join(path.parts[1:])
    key = tag + ("-" + slug if slug else "")
    if not re.fullmatch(r"T\d{5}(?:-[A-Za-z0-9_-]{1,100})?", key):
        key = tag + "-source-" + hashlib.sha256(relative.encode("utf-8")).hexdigest()[:16]
    return key


def reaction_placeholder(key: str, title: str) -> str:
    return f'<div data-transcription-reaction="{html.escape(key, quote=True)}" data-reaction-title="{html.escape(title, quote=True)}"></div>'


def chat_markup(key: str, template: str) -> str:
    if template.count('data-transcription-chat=""') != 1:
        raise ValueError("В шаблоне комментариев нужен один пустой ключ")
    return template.replace('data-transcription-chat=""', f'data-transcription-chat="{html.escape(key, quote=True)}"', 1)


def attach_block_reactions(source: str, keys: dict[str, str], texts: dict[str, str]) -> tuple[str, set[str]]:
    previous_keys = {}
    for block in sos_item_blocks(source):
        field = re.search(r'<textarea\b[^>]*id="([^"]+)"', block)
        previous = re.search(r'data-transcription-reaction="([^"]+)"', block)
        if field and previous and previous.group(1) in keys.values():
            previous_keys[field.group(1)] = previous.group(1)
    source = REACTION_PLACEHOLDER.sub("", source)
    text_keys = {re.sub(r"\s+", " ", text).strip(): keys[relative] for relative, text in texts.items()}
    inline_keys = {"sos-text-1": "T00027-sos-text-1"}
    added = set()
    for original_block in sos_item_blocks(source):
        block = CHAT_PLACEHOLDER.sub("", original_block)
        field = re.search(r'<textarea\b[^>]*id="([^"]+)"[^>]*>(.*?)</textarea>', block, re.S)
        if not field or not html.unescape(field.group(2)).strip():
            continue

        link = PUBLISHED_LINK.search(block)
        translation = AUTHOR_TRANSLATION.search(block)
        relative = link.group(1) if link else translation.group(1) if translation else ""
        text = re.sub(r"\s+", " ", html.unescape(field.group(2))).strip()
        key = keys.get(relative) or previous_keys.get(field.group(1)) or text_keys.get(text) or inline_keys.get(field.group(1))
        if not key:
            raise ValueError(f"Не задан постоянный ключ транскрипции: {field.group(1)}")

        summary = re.search(r'<summary>(.*?)</summary>', block, re.S)
        title = html.unescape(re.sub(r'<[^>]+>', '', summary.group(1))) if summary else field.group(1)
        closing = block.rfind('</div>')
        if closing < 0:
            raise ValueError(f"Нет блока транскрипции: {field.group(1)}")
        replacement = (block[:closing] + reaction_placeholder(key, title)
                       + f'<div data-transcription-chat="{html.escape(key, quote=True)}" hidden></div>' + block[closing:])
        source = source.replace(original_block, replacement, 1)
        added.add(key)
    return source, added


def transcription_section(markdown: str, heading: str) -> str:
    return transcription_text(markdown, heading)


def original_transcription(markdown: str) -> str:
    return transcription_section(markdown, "Необработанная транскрипция")


def resolve_copy_text(markdown: str, entry: dict, inline_text: str = "") -> str:
    if section_markdown(markdown, ("Транскрипция для вывода",)) is not None:
        return transcription_section(markdown, "Транскрипция для вывода")
    return (entry.get("copyText") or transcription_section(markdown, "Текст для копирования")
            or inline_text or original_transcription(markdown) or entry.get("bodyText", ""))


def calendar_entry(relative: str, markdown: str, panel_source: str, existing: dict | None = None) -> dict:
    received = re.search(r'^-?\s*Дата и время получения транскрипции:\s*([^\n]+)', markdown, re.M)
    date_note = received.group(1).strip() if received else ""
    calendar_date = ""
    appearance_time = ""
    # Дата разбора и дата повторной передачи не заменяют дату получения
    received_date = re.match(r'(?:уч[её]тная дата\s+)?(\d{2})\.(\d{2})\.(\d{4})(.*)', date_note, re.I)
    if received_date:
        try:
            calendar_date = date(int(received_date.group(3)), int(received_date.group(2)), int(received_date.group(1))).isoformat()
        except ValueError:
            pass
        received_time = re.match(r'(?:\s*,\s*|\s+)(\d{1,2}):(\d{2})(?::\d{2})?', received_date.group(4))
        if calendar_date and received_time and int(received_time.group(1)) < 24 and int(received_time.group(2)) < 60:
            appearance_time = f"{int(received_time.group(1)):02d}:{received_time.group(2)}"

    heading = re.search(r'^#\s+(.+)$', markdown, re.M)
    title = html.unescape(re.sub(r'<[^>]+>', '', inline(heading.group(1), SOURCE_URL + relative))) if heading else Path(relative).stem
    title = re.sub(r'^§T\d{5}\s*[—–-]\s*', '', title)
    group = ""
    for panel in PANEL.finditer(panel_source):
        if relative in copy_texts(panel.group(0)):
            panel_title = re.search(r'data-title="([^"]+)"', panel.group(0))
            group = html.unescape(panel_title.group(1)) if panel_title else ""
            break

    entry = dict(existing or {})
    entry.update({
        "type": entry.get("type", "analysis"),
        "title": entry.get("title") or title,
        "group": entry.get("group") or group,
        "calendarDate": (entry.get("calendarDate") or "") if existing is not None else calendar_date,
        "appearanceTime": (entry.get("appearanceTime") or "") if existing is not None else appearance_time,
        "dateNote": entry.get("dateNote") or date_note,
        "sourceUrl": SOURCE_URL + relative,
        "reactionKey": reaction_key(relative, existing),
        "analysisMode": analysis_mode(markdown),
        "acquisitionType": acquisition_type(markdown),
    })
    entry.setdefault("published", True)
    entry.setdefault("externalKey", entry["reactionKey"])
    return entry


def translation_labels_html(content: str, source_url: str, transcription: str, *, nested_lists: bool = False) -> str:
    rendered = markdown_html(content, source_url, nested_lists=nested_lists)

    def words(text: str) -> set[str]:
        return set(re.findall(r"[^\W\d_]+(?:-[^\W\d_]+)*", text.casefold().replace("‑", "-")))

    source_words = words(transcription)
    source_parts = set()

    # Разбор может разделять исходное составное слово по дефисам
    for source in source_words:
        parts = source.split("-")
        source_parts.update(
            "-".join(parts[start:end])
            for start in range(len(parts))
            for end in range(start + 1, len(parts) + 1)
        )

    def source_label(text: str) -> bool:
        label_words = words(text) - {"или"}
        return bool(label_words) and all(
            word in source_parts or any(
                len(word) >= 7 and len(source) >= 7 and word[0] == source[0]
                and SequenceMatcher(None, word, source).ratio() >= 0.9
                for source in source_words
            )
            for word in label_words
        )

    labels = []
    for paragraph in re.split(r"\n[ \t]*(?:>[ \t]*)?\n", content):
        lines = paragraph.strip().splitlines()
        if not lines or lines[0].lstrip().startswith(("#", "```", "|", "«", '"')):
            continue
        first = lines[0].strip()
        tag = "blockquote" if first.startswith("> ") else "li" if first.startswith(("- ", "* ")) else "p"
        if tag == "blockquote":
            first = first[2:]
        if tag == "li":
            first = first[2:]
        pair = re.split(r"\s+(?:→|->|—|–|=)\s+|:\s+", first, maxsplit=1)
        label = pair[0].strip()
        plain = label.replace("**", "").replace("`", "")
        explicit = len(pair) == 2
        if len(plain) > 120 or len(words(plain)) > 8 or "[" in plain:
            continue
        if not explicit and (len(lines) < 2 or not plain.endswith(("!", ".", ":"))):
            continue
        labels.append((tag, label, explicit, source_label(plain)))

    # Повторяемая структура позволяет отметить подписи с отличающимся написанием без исправления исходника
    paired = [item for item in labels if not item[2]]
    matched = [item for item in paired if item[3]]
    word_by_word = len(matched) >= 2 and len(matched) * 2 >= len(paired)
    for tag, label, explicit, matched_source in labels:
        if not matched_source or not (explicit or word_by_word):
            continue
        prefix = inline(label, source_url)
        rendered = rendered.replace(f"<{tag}>{prefix}", f'<{tag}><mark class="transcription-term">{prefix}</mark>', 1)
    return rendered


def author_translation_markdown(markdown: str) -> str:
    for heading in TRANSLATION_HEADINGS:
        content = section_markdown(markdown, (heading,), levels=(2, 3), parenthetical=True)
        if content:
            return content
    return ""


def commentary_markdown(markdown: str) -> str:
    legacy = section_markdown(markdown, ("Комментарий к обращению",), levels=(2, 3))
    if legacy is not None:
        return legacy
    comments = section_markdown(markdown, ("Комментарии и варианты",))
    if comments is None:
        return ""
    words = section_markdown(markdown, ("Пословный разбор",))
    return "\n\n".join(section for section in (words, comments) if section)


def author_translation_html(markdown: str, source_url: str, copy_text: str = "") -> str:
    content = author_translation_markdown(markdown)
    if content:
        transcription = "\n".join((original_transcription(markdown), transcription_section(markdown, "Текст для копирования"), copy_text))
        has_commentary = bool(commentary_markdown(markdown))
        has_nested_translation = re.search(r'(?m)^[ \t]{2,}[-*] ', content) is not None
        return translation_labels_html(content, source_url, transcription, nested_lists=has_commentary or has_nested_translation)
    return '<p>Пока не заполнено</p>'


def purpose_html(source_path: Path) -> str:
    markdown = source_path.read_text(encoding="utf-8")
    section = section_markdown(markdown, "Назначение")
    if section:
        relative = source_path.relative_to(ROOT).as_posix()
        return markdown_html(section, SOURCE_URL + relative)
    return '<p>Пока не заполнено</p>'


def analysis_mode(markdown: str) -> str:
    marker = re.search(r"^разбор транскрипции: (авто|не требуется|ручной, 100%|(?:100|[1-9]?\d)%)$", markdown, re.M)
    if marker:
        value = marker.group(1)
        return {"ручной, 100%": "manual", "авто": "auto", "не требуется": "not_required"}.get(value, value)
    return "manual" if re.search(r"пометки\s+автора|\bуточнено\b", markdown, re.I) else "auto"


def analysis_label(mode: str) -> str:
    label = {"manual": "100%", "not_required": "не требуется"}.get(mode, mode if re.fullmatch(r"(?:100|[1-9]?\d)%", mode) else "авто")
    return "Разбор транскрипции: " + label


def acquisition_type(markdown: str) -> str:
    marker = re.search(r'^-?\s*Способ получения транскрипции:\s*(аудиозапись|письменная запись)\.?\s*$', markdown, re.M | re.I)
    return "audio" if marker and marker.group(1).casefold() == "аудиозапись" else "written"


def acquisition_icon(kind: str) -> str:
    kind = "audio" if kind == "audio" else "written"
    label = "Транскрипция получена из аудиозаписи" if kind == "audio" else "Транскрипция получена письменно"
    return (f'<span class="transcription-acquisition" data-acquisition-type="{kind}" title="{label}" role="img" aria-label="{label}">'
            f'<img src="/assets/transcription-{kind}.svg" alt="" width="20" height="20"></span>')


def ai_page_markdown(panel: str, entries: dict[str, dict], copy_texts: dict[str, str]) -> str:
    lead = re.search(r'<p class="section-lead">(.*?)</p>', panel, re.S)
    intro = html.unescape(re.sub(r'<[^>]+>', '', lead.group(1))) if lead else ""
    parts = ["# For AI", intro, f"[HTML page]({BASE_URL}/for-ai/)",
             "Technical labels are in English; source content remains in its original language. "
             "Dates and analysis labels reproduce source notes, not independent validation. "
             "Relative links within source excerpts refer to the linked GitHub originals."]

    for block in sos_item_blocks(panel):
        link = PUBLISHED_LINK.search(block)
        translation = AUTHOR_TRANSLATION.search(block)
        relative = link.group(1) if link else translation.group(1) if translation else ""
        if not relative or relative not in copy_texts:
            raise ValueError("Не найден источник блока страницы для ИИ")
        markdown = (ROOT / relative).read_text(encoding="utf-8")
        entry = entries.get(relative, {})
        summary = re.search(r'<summary>(.*?)</summary>', block, re.S)
        title = html.unescape(re.sub(r'<[^>]+>', '', summary.group(1))) if summary else entry.get("title", relative)
        route = transcription_route(ROOT / relative)
        date = re.search(r'(?:Дата и время получения транскрипции:|\*\*Дата получения:\*\*)\s*([^\n]+)', markdown)
        date_note = entry.get("dateNote") or (date.group(1).strip() if date else "")
        mode = analysis_mode(markdown)
        label = {"auto": "automatic", "manual": "manual, 100%"}.get(mode, mode)
        metadata = ["- Source: author."]
        if date_note:
            metadata.append(f"- Date (source note): {date_note}")
        metadata.extend((f"- Analysis label: {label}.",
                         f"- [Full source (Markdown)]({BASE_URL}{route}index.md)",
                         f"- [Repository source]({SOURCE_URL}{relative})",
                         f"- [HTML card]({BASE_URL}{route})"))
        parts.extend((f"## {title}", "\n".join(metadata)))

        purpose = PURPOSE_PLACEHOLDER.search(block)
        purpose_relative = purpose.group(1) if purpose else entry.get("purposeSource", relative)
        purpose_markdown = (ROOT / purpose_relative).read_text(encoding="utf-8")
        purpose_section = section_markdown(purpose_markdown, "Назначение")
        if purpose_section:
            parts.extend(("### Purpose (proposed)", purpose_section))
            if purpose_relative != relative:
                parts.append(f"[Purpose source]({SOURCE_URL}{purpose_relative})")

        original = original_transcription(markdown) or transcription_section(markdown, "Исходная строка")
        for heading, text in (("Original transcription", original), ("Text for copying", copy_texts[relative])):
            if text:
                fence = "`" * max(3, max((len(run) + 1 for run in re.findall(r'`+', text)), default=3))
                parts.extend((f"### {heading}", f"{fence}text\n{text}\n{fence}"))

        translation_text = author_translation_markdown(markdown)
        if translation_text:
            parts.extend(("### Proposed translation", translation_text))
        for source_heading, heading in (("Сопроводительные слова автора", "Author comments"), ("Якоря для нейронки", "Notes for AI")):
            section = section_markdown(markdown, source_heading, levels=(2, 3))
            if section:
                parts.extend((f"### {heading}", section))

    parts.extend(("## Translation method", f"[Methodologies, dictionaries and related documents (HTML)]({BASE_URL}{ROUTES['translation']})",
                  f"[Word dictionary (HTML)]({BASE_URL}{ROUTES['dictionary-words']})",
                  f"[Suffix dictionary (HTML)]({BASE_URL}{ROUTES['dictionary-suffixes']})",
                  f"[Abbreviations and full short words (HTML)]({BASE_URL}{ROUTES['article-channel-abbreviations']})"))
    return "\n\n".join(part for part in parts if part) + "\n"


def dictionary_languages(content: str) -> list[str]:
    aliases = (
        ("иврит", r"иврит\w*|ивр\."),
        ("греческий", r"греческ\w*|греч\."),
        ("латинский", r"латинск\w*|лат\."),
        ("арамейский", r"арамейск\w*|арам\."),
        ("аккадский", r"аккадск\w*"),
        ("арабский", r"арабск\w*|араб\."),
        ("японский", r"японск\w*|япон\.|яп\."),
        ("старославянский", r"старославянск\w*|ст\.-слав\."),
        ("славянский", r"славянск\w*|(?<!ст\.-)слав\."),
        ("русский", r"русск\w*|рус(?:ск)?\."),
        ("английский", r"английск\w*|англ\."),
        ("караимский", r"караимск\w*"),
        ("сирийский", r"сирийск\w*"),
    )
    result = []
    for line in content.splitlines():
        line = line.strip()
        field = re.match(r"^(?:-\s+)?\*\*([^*\n]+):\*\*\s*(.+)$", line)
        if field:
            label, value = field.groups()
            if value.strip() in {"—", "-", "Пока не заполнено"}:
                continue
            if any(re.fullmatch(pattern, label, re.I) for _, pattern in aliases):
                candidate = label
            elif re.search(r"язык|предложен|предположен|корень|значение|двойной смысл|кандидат|поправка", label, re.I):
                candidate = value
            else:
                continue
        elif line.startswith("Словарная гипотеза:"):
            candidate = line.split("`", 1)[0]
        elif re.search(r"(?<!\w)(?:лат|греч|арам|ивр|рус|русск|англ|слав|япон|яп)\.(?!\w)", line, re.I):
            candidate = line
        elif re.match(r"^Русские слова\b", line, re.I):
            candidate = line
        else:
            continue

        candidate = re.sub(r"https?://\S+", "", candidate)

        # Язык берётся из пометок лексического разбора, а не из алфавита или номера Стронга
        matches = sorted((match.start(), name) for name, pattern in aliases
                         for match in re.finditer(rf"(?<!\w)(?:{pattern})(?!\w)", candidate, re.I))
        result.extend(name for _, name in matches)

    result = list(dict.fromkeys(result))
    return [name for name in result if name != "славянский" or "старославянский" not in result]


def dictionary_fields(title: str, content: str) -> list[list[str]]:
    fields: dict[str, list[str]] = {}
    for line in content.splitlines():
        match = re.match(r"^(?:-\s+)?\*\*([^*\n]+):\*\*\s*(.+)$", line.strip())
        if match:
            fields.setdefault(match.group(1).casefold(), []).append(match.group(2))

    def values(labels: tuple[str, ...]) -> list[str]:
        return list(dict.fromkeys(value for label in labels for value in fields.get(label, [])))

    writing = values(("написание", "корень", "иврит", "японский", "славянский"))
    transcription = values(("транскрипция", "слово", "ручная форма", "форма автора", "звук", "точная форма и движок", "ручная форма f7", "ручная форма и контекст", "транскрипция / форма разбора")) or [title]
    engine_marker = r",\s*(ZIPA|W2V2|Allosaurus)\b"
    obtained = [engine for text in transcription for engine in re.findall(engine_marker, text)] or ["ручная"]
    transcription = [re.sub(engine_marker, "", text).strip() for text in transcription]

    dictionary = values(("перевод из словаря",))
    interpretation = values(("трактовка автора", "толкование автора", "авторское толкование", "образ пользователя"))
    # Чтение составителя показывается с указанием источника, отдельно от словарного перевода
    interpretation.extend(f"Чтение источника (независимо не проверено): {value}"
                          for value in values(("предложенный перевод источника",)))
    language = values(("язык", "языки")) or dictionary_languages(content)
    dictionary_notes = re.findall(r"^Словарная гипотеза: [^\n]+", content, re.M)
    if not dictionary:
        dictionary.extend(dictionary_notes)

    if not writing:
        for note in dictionary_notes:
            writing.extend(re.findall(r"`([\u0370-\u03ff\u1f00-\u1fff\u0590-\u05ff\u3040-\u30ff\u4e00-\u9fff]+)`", note))

    # Словарные значения извлекаются только из явно записанной пары леммы и глосса
    if not dictionary:
        foreign = r"[A-Za-z\u0370-\u03ff\u1f00-\u1fff\u0590-\u05ff\u3040-\u30ff\u4e00-\u9fff]+"
        pair = rf"(?<![-\w*`])(?P<word>`{foreign}`|\*{foreign}\*|{foreign})\s*\((?P<gloss>[^()\n]+)\)"
        for match in re.finditer(pair, content):
            gloss = match.group("gloss")
            if content[match.end():].lstrip().startswith('?') or re.search(r"→|=>", gloss):
                continue

            quoted = re.search(r"«([^»]+)»", gloss)
            if quoted:
                gloss = quoted.group(1)
            else:
                gloss = re.sub(r"^[HG]\d+,\s*", "", gloss)
                if (re.search(r"[HG]\d|[+=]", gloss) or not re.search(r"[А-Яа-яЁё]", gloss)
                        or re.match(r"^(?:арам|греч|лат|иврит|ивр|япон|яп|англ|слав|рус)\.?$", gloss.strip(), re.I)):
                    continue

            word = match.group("word").strip("`*")
            dictionary.append(f"{word} — {gloss}")
            if not values(("написание", "корень", "иврит", "японский", "славянский")):
                writing.append(word)

    return [list(dict.fromkeys(column)) for column in (writing, transcription, obtained, dictionary, interpretation, language)]


def translation_material_html(markdown: str, source_url: str) -> str:
    content = markdown_html(markdown, source_url)
    # Ссылки на материалы сайта открываются в текущей локальной или боевой версии
    content = content.replace(f'href="{BASE_URL}/', 'href="/')
    # Материалы промпта вложены в общий сворачивающийся блок с заголовком h3
    return re.sub(r'<(/?)h([2-6])>', lambda match: f'<{match.group(1)}h{min(int(match.group(2)) + 2, 6)}>', content)


def dictionary_entry_id(namespace: str, writing: str) -> str:
    # Якорь зависит от написания, чтобы изменение толкования не меняло ссылку
    key = writing.casefold().strip().encode("utf-8")
    return namespace + "-" + hashlib.sha256(key).hexdigest()[:16]


def dictionary_html(markdown: str, source_url: str) -> str:
    markdown = markdown.replace("\r\n", "\n")
    headings = list(re.finditer(r"^## (.+)$", markdown, re.M))
    introduction = markdown[:headings[0].start()] if headings else markdown
    introduction = re.sub(r'^# [^\n]+\n', '', introduction, count=1)
    labels = ("Написание", "транскрипция", "Транскрипция получена", "перевод из словаря", "трактовка автора", "язык")
    rows = []
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(markdown)
        content = markdown[heading.end():end].strip()
        columns = dictionary_fields(heading.group(1), content)
        cells = []
        for number, (label, values) in enumerate(zip(labels, columns)):
            tag = 'th' if number == 1 else 'td'
            attributes = ' scope="row"' if number == 1 else ''
            text = markdown_html('\n\n'.join(values), source_url) if values else '<p class="dictionary-empty">Пока не заполнено</p>'
            if number == 4:
                text += ('<details class="dictionary-sources"><summary>Разборы и источники</summary>'
                         '<div class="dictionary-source-body">' + markdown_html(content, source_url) + '</div></details>')
            cells.append(f'<{tag}{attributes} data-label="{label}">{text}</{tag}>')

        anchor = dictionary_entry_id("word", heading.group(1))
        rows.append(f'<tr id="{anchor}">' + ''.join(cells) + '</tr>')
    return (translation_material_html(introduction, source_url)
            + '<div class="dictionary-table-wrap"><table class="dictionary-table" aria-labelledby="dictionary-words-title">'
            '<thead><tr>' + ''.join(f'<th scope="col">{label}</th>' for label in labels) + '</tr></thead>'
            '<tbody>' + ''.join(rows) + '</tbody></table></div>')


def suffix_dictionary_html(markdown: str, source_url: str) -> str:
    markdown = markdown.replace("\r\n", "\n")
    table_match = re.search(r'^\|[^\n]+\|(?:\n|$)(?:\|[^\n]+\|(?:\n|$))*', markdown, re.M)
    if not table_match:
        raise ValueError("Не найдена таблица словаря суффиксов")
    introduction = re.sub(r'^# [^\n]+\n', '', markdown[:table_match.start()], count=1)
    lines = [line for line in markdown.splitlines() if line.startswith('|') and line.endswith('|')]
    rows = [[cell.strip() for cell in re.split(r'(?<!\\)\|', line[1:-1])] for line in lines]
    labels = ("Окончание", "Форма-источник", "Значение", "Слова")
    if (len(rows) < 3 or tuple(rows[0]) != labels
            or not all(len(row) == len(labels) for row in rows)
            or not all(re.fullmatch(r':?-{3,}:?', cell) for cell in rows[1])):
        raise ValueError("Неверная структура словаря суффиксов")

    rendered_rows = []
    for row in rows[2:]:
        cells = []
        for index, (label, value) in enumerate(zip(labels, row)):
            tag = 'th' if index == 0 else 'td'
            scope = ' scope="row"' if index == 0 else ''
            content = inline(value.replace(r'\|', '|'), source_url)
            cells.append(f'<{tag}{scope} data-label="{label}">{content}</{tag}>')
        anchor = dictionary_entry_id("suffix", row[0])
        rendered_rows.append(f'<tr id="{anchor}">' + ''.join(cells) + '</tr>')
    return (translation_material_html(introduction, source_url)
            + '<div class="dictionary-table-wrap"><table class="dictionary-table suffix-dictionary-table" aria-labelledby="dictionary-suffixes-title">'
            '<thead><tr>' + ''.join(f'<th scope="col">{label}</th>' for label in labels) + '</tr></thead>'
            '<tbody>' + ''.join(rendered_rows) + '</tbody></table></div>'
            + translation_material_html(markdown[table_match.end():], source_url))


def abbreviation_dictionary_html(text: str) -> str:
    text = text.replace("\r\n", "\n")
    table_match = re.search(r'^\|[^\n]+\|(?:\n|$)(?:\|[^\n]+\|(?:\n|$))*', text, re.M)
    if not table_match:
        raise ValueError("Не найдена таблица словаря сокращений")
    labels = ("запись в транскрипции", "пример вхождения в транскрипцию", "полное слово", "заметка", "язык")
    lines = table_match.group(0).strip().splitlines()
    rows = [[cell.strip() for cell in re.split(r'(?<!\\)\|', line[1:-1])] for line in lines]
    if (len(rows) < 3 or tuple(rows[0]) != labels
            or not all(len(row) == len(labels) for row in rows)
            or not all(re.fullmatch(r':?-{3,}:?', cell) for cell in rows[1])):
        raise ValueError("Неверная структура таблицы словаря сокращений")
    introduction = re.sub(r'^# [^\n]+\n', '', text[:table_match.start()], count=1).strip()
    rendered_rows = []
    for row in rows[2:]:
        cells = []
        for index, (label, value) in enumerate(zip(labels, row)):
            tag = 'th' if index == 0 else 'td'
            scope = ' scope="row"' if index == 0 else ''
            value = value.replace(r'\|', '|').replace('<br>', '\n\n')
            content = markdown_html(value, SOURCE_URL + "docs/dictionary/abbreviations-source.txt") if value else ''
            if index == 3 and len(value) > 500:
                content = ('<details class="dictionary-sources"><summary>Заметки, контексты и источники</summary>'
                           '<div class="dictionary-source-body">' + content + '</div></details>')
            cells.append(f'<{tag}{scope} data-label="{label}">{content}</{tag}>')
        anchor = dictionary_entry_id("abbreviation", row[0])
        rendered_rows.append(f'<tr id="{anchor}">' + ''.join(cells) + '</tr>')

    return (translation_material_html(introduction, SOURCE_URL + "docs/dictionary/abbreviations-source.txt")
            + '<div class="dictionary-table-wrap"><table class="dictionary-table abbreviation-dictionary-table" aria-labelledby="article-channel-abbreviations-title">'
            '<thead><tr>' + ''.join(f'<th scope="col">{label}</th>' for label in labels) + '</tr></thead>'
            '<tbody>' + ''.join(rendered_rows) + '</tbody></table></div>'
            + translation_material_html(text[table_match.end():], SOURCE_URL + "docs/dictionary/abbreviations-source.txt"))


def main() -> None:
    source = (SOURCE / "index.html").read_text(encoding="utf-8")
    ai_panel = next(match.group(0) for match in PANEL.finditer(source) if match.group(1) == "for-ai")
    chat_template_match = CHAT_TEMPLATE.search(source)
    if not chat_template_match:
        raise ValueError("Не найден шаблон комментариев")
    chat_template = chat_template_match.group(1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    translation_sources = {match.group(1) for match in AUTHOR_TRANSLATION.finditer(source) if match.group(1)}
    purpose_sources = {match.group(1) for match in PURPOSE_PLACEHOLDER.finditer(source) if match.group(1)}
    entries = json.loads((SOURCE / "data" / "entries.json").read_text(encoding="utf-8"))
    by_source = {entry["sourceUrl"].removeprefix(SOURCE_URL): entry for entry in entries
                 if entry.get("published") and entry.get("type") in {"analysis", "manual_transcription"}}
    text_for_copy = copy_texts(source)
    published_paths = set(by_source) | set(text_for_copy)
    reaction_keys = {relative: reaction_key(relative, by_source.get(relative)) for relative in sorted(published_paths)}
    if len(set(reaction_keys.values())) != len(reaction_keys):
        raise ValueError("Разные транскрипции имеют одинаковый ключ голосования")
    source, inline_reaction_keys = attach_block_reactions(source, reaction_keys, text_for_copy)
    reaction_manifest_path = ROOT / "site/reactions-api/transcriptions.json"
    reaction_manifest_path.write_text(json.dumps({"schema": 1, "keys": sorted(set(reaction_keys.values()) | inline_reaction_keys)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    analysis_modes = {}
    acquisition_types = {}
    translations = {}
    purposes = {}
    resolved_copy_texts = {}
    source_markdowns = {}
    sources_for_purposes: set[Path] = set()
    for relative in sorted(published_paths | translation_sources | purpose_sources):
        source_path = ROOT / relative
        if not relative.startswith("docs/transcriptions/") or not source_path.is_file() or not source_path.is_relative_to(ROOT / "docs" / "transcriptions"):
            raise ValueError(f"Нет исходника перевода: {relative}")
        markdown = source_path.read_text(encoding="utf-8")
        source_markdowns[relative] = markdown
        entry = by_source.get(relative, {})
        resolved_copy_texts[relative] = resolve_copy_text(markdown, entry, text_for_copy.get(relative, ""))
        analysis_modes[relative] = analysis_mode(markdown)
        acquisition_types[relative] = acquisition_type(markdown)
        translations[relative] = author_translation_html(markdown, SOURCE_URL + relative, resolved_copy_texts[relative])
        purpose_relative = by_source.get(relative, {}).get("purposeSource", relative)
        purpose_path = ROOT / purpose_relative
        if not purpose_relative.startswith("docs/transcriptions/") or not purpose_path.is_file() or not purpose_path.is_relative_to(ROOT / "docs" / "transcriptions"):
            raise ValueError(f"Нет источника назначения: {purpose_relative}")
        purposes[relative] = purpose_html(purpose_path)
        if purpose_relative != relative:
            sources_for_purposes.add(purpose_path)

    def insert_translation(match: re.Match[str]) -> str:
        relative = match.group(1)
        content = translations.get(relative, '<p>Пока не заполнено</p>')
        return f'<div class="author-translation-body">{content}</div>'

    def insert_purpose(match: re.Match[str]) -> str:
        relative = match.group(1)
        content = purposes.get(relative, '<p>Пока не заполнено</p>')
        return f'<div class="transcription-purpose-body">{content}</div>'

    source = re.sub(
        r'(<p class="analysis-mode" data-analysis-source="([^"]*)">).*?</p>',
        lambda match: match.group(1) + analysis_label(analysis_modes.get(match.group(2), "auto")) + '</p>',
        source,
    )
    source = attach_acquisition_icons(source, acquisition_types)
    source = synchronize_copy_fields(source, resolved_copy_texts, reaction_keys)
    (SOURCE / "index.html").write_text(source, encoding="utf-8")

    source = re.sub(
        r'<p class="analysis-mode" data-analysis-source="([^"]*)">.*?</p>',
        lambda match: '<p class="analysis-mode">' + analysis_label(analysis_modes.get(match.group(1), "auto")) + '</p>',
        source,
    )
    for entry in entries:
        relative = entry.get("sourceUrl", "").removeprefix(SOURCE_URL)
        if entry.get("type") == "news":
            entry.pop("analysisMode", None)
        else:
            entry["analysisMode"] = analysis_modes.get(relative, "auto")
        if entry.get("type") in {"manual_transcription", "analysis"}:
            entry["acquisitionType"] = acquisition_types.get(relative, "written")
            if relative in source_markdowns and section_markdown(source_markdowns[relative], ("Транскрипция для вывода",)) is not None:
                entry["copyText"] = resolved_copy_texts[relative]
        if entry.get("published") and entry.get("type") in {"manual_transcription", "analysis"} and relative in reaction_keys:
            entry["reactionKey"] = reaction_keys[relative]
        else:
            entry.pop("reactionKey", None)
    (SOURCE / "data" / "entries.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (SOURCE / "data" / "analysis-modes.json").write_text(json.dumps(analysis_modes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    source = CHAT_PLACEHOLDER.sub(lambda match: chat_markup(match.group(1), chat_template), source)
    source = AUTHOR_TRANSLATION.sub(insert_translation, source)
    source = PURPOSE_PLACEHOLDER.sub(insert_purpose, source)

    def insert_document(match: re.Match[str]) -> str:
        relative = html.unescape(match.group(1))
        document = (SOURCE / relative).resolve()
        if not document.is_file() or document.suffix.lower() not in {".txt", ".md"} or not document.is_relative_to(SOURCE / "assets" / "documents"):
            raise ValueError(f"Нет публичного текстового документа: {relative}")
        text = document.read_text(encoding="utf-8-sig")
        if document.suffix.lower() == ".md":
            # Заголовок источника уже показан в шапке статьи
            text = re.sub(r"^# [^\n]+\n", "", text, count=1)
            # Знаки печатной таблицы должны оставаться текстом, включая похожий на Markdown-ссылку пример
            literal_tables = relative == "assets/documents/transcription-symbols-print.md"
            content = markdown_html(text, BASE_URL + "/" + quote(relative), literal_tables=literal_tables)
        else:
            content = plain_document_html(text)
        return '<div class="help-page">' + content + '</div>'

    source = DOCUMENT_PLACEHOLDER.sub(insert_document, source)
    news_cards = []
    for entry in entries:
        if not entry.get("published") or entry.get("type") != "news":
            continue
        news_body = markdown_html(entry.get("bodyText", ""), BASE_URL + "/news/")
        news_body = news_body.replace(f'href="{BASE_URL}/', 'href="/').replace('<p>', '<p class="entry-body">')
        news_cards.append(
            '<article class="entry-card">'
            f'<p class="entry-tag">{html.escape(entry.get("group", "Новости"))}</p>'
            f'<h3>{html.escape(entry.get("title", ""))}</h3>'
            f'{news_body}<p class="entry-meta">Дата публикации: {html.escape(entry.get("dateNote", ""))}</p>'
            '</article>'
        )
    source = source.replace('<div class="collection-results" id="news-results"></div>',
                            '<div class="collection-results" id="news-results">' + "\n".join(news_cards) + '</div>', 1)
    methodology_path = ROOT / "docs" / "dictionary" / "methodology.md"
    dictionary_path = ROOT / "docs" / "dictionary" / "combined.md"
    suffix_methodology_path = ROOT / "docs" / "dictionary" / "suffix-methodology.md"
    suffix_path = ROOT / "docs" / "dictionary" / "suffixes.md"
    prompt_path = SOURCE / "data" / "promptForAlice_guessingTheMeaningOfTheGlossary.txt"
    phonetics_path = SOURCE / "assets" / "documents" / "Звуки которых нет в иврите но есть в Русском языке.txt"
    abbreviations_path = ROOT / "docs" / "dictionary" / "abbreviations-source.txt"
    archive_sources = {
        "PROMPT_general.txt": (prompt_path,),
        "dictionary_of_words.txt": (methodology_path, dictionary_path),
        "dictionary_of_suffixes_and_particles.txt": (suffix_methodology_path, suffix_path),
        "phonetics_rus_vs_hebrew.txt": (phonetics_path,),
        "dictionary_of_abbreviations.txt": (abbreviations_path,),
    }
    # Страница и архив используют один снимок исходников, чтобы их содержание совпадало
    material_bytes = {path: path.read_bytes() for paths in archive_sources.values() for path in paths}
    archive_contents = {name: b"".join(material_bytes[path] for path in paths) for name, paths in archive_sources.items()}
    (SOURCE / "data" / "promptForAlice_guessingTheMeaningOfTheGlossary.min.txt").write_bytes(
        b"".join(line for line in material_bytes[prompt_path].splitlines(keepends=True) if line.strip())
    )
    for identifier, filename, path in (
        ("translation-prompt-content", "prompt-general.html", prompt_path),
        ("translation-phonetics-content", "prompt-phonetics.html", phonetics_path),
    ):
        fragment = translation_material_html(material_bytes[path].decode("utf-8-sig"), SOURCE_URL + path.relative_to(ROOT).as_posix())
        (SOURCE / "data" / filename).write_text(fragment, encoding="utf-8")
        placeholder = f'<div class="help-page dictionary-methodology" id="{identifier}"></div>'
        source = source.replace(placeholder, f'<div class="help-page dictionary-methodology" id="{identifier}">' + fragment + '</div>')
    methodology_markdown = material_bytes[methodology_path].decode("utf-8-sig")
    methodology = translation_material_html(methodology_markdown, SOURCE_URL + "docs/dictionary/methodology.md")
    (SOURCE / "data" / "dictionary-methodology.html").write_text(methodology, encoding="utf-8")
    source = source.replace('<div class="help-page dictionary-methodology" id="dictionary-words-methodology"></div>',
                            '<div class="help-page dictionary-methodology" id="dictionary-words-methodology">' + methodology + '</div>')
    dictionary = dictionary_html(material_bytes[dictionary_path].decode("utf-8-sig"), SOURCE_URL + "docs/dictionary/combined.md").replace(f'href="{BASE_URL}/', 'href="/')
    (SOURCE / "data" / "dictionary.html").write_text(dictionary, encoding="utf-8")
    source = source.replace('<div id="dictionary-words-content"></div>', '<div id="dictionary-words-content">' + dictionary + '</div>')
    suffix_methodology_markdown = material_bytes[suffix_methodology_path].decode("utf-8-sig")
    suffix_methodology = translation_material_html(suffix_methodology_markdown, SOURCE_URL + "docs/dictionary/suffix-methodology.md")
    suffix_methodology = suffix_methodology.replace(f'href="{SOURCE_URL}docs/dictionary/suffixes.md"', 'href="/dictionaries/suffixes-and-particles/"')
    suffix_dictionary = suffix_dictionary_html(material_bytes[suffix_path].decode("utf-8-sig"), SOURCE_URL + "docs/dictionary/suffixes.md").replace(f'href="{BASE_URL}/', 'href="/')
    (SOURCE / "data" / "suffix-methodology.html").write_text(suffix_methodology, encoding="utf-8")
    (SOURCE / "data" / "suffix-dictionary.html").write_text(suffix_dictionary, encoding="utf-8")
    source = source.replace('<div class="help-page dictionary-methodology" id="dictionary-suffixes-methodology"></div>',
                            '<div class="help-page dictionary-methodology" id="dictionary-suffixes-methodology">' + suffix_methodology + '</div>')
    source = source.replace('<div id="dictionary-suffixes-content"></div>', '<div id="dictionary-suffixes-content">' + suffix_dictionary + '</div>')
    abbreviations = abbreviation_dictionary_html(material_bytes[abbreviations_path].decode("utf-8-sig")).replace(f'href="{BASE_URL}/', 'href="/')
    (SOURCE / "data" / "abbreviations-dictionary.html").write_text(abbreviations, encoding="utf-8")
    (SOURCE / "data" / "dictionary_of_abbreviations.txt").write_bytes(material_bytes[abbreviations_path])
    article_abbreviations = abbreviations
    (SOURCE / "data" / "abbreviations-article.html").write_text(article_abbreviations, encoding="utf-8")
    source = source.replace('<div id="article-channel-abbreviations-content"></div>', '<div id="article-channel-abbreviations-content">' + article_abbreviations + '</div>')

    analyses_path = ROOT / "docs" / "TRANSCRIPTION_ANALYSES.md"
    analyses_markdown = re.sub(r"^# [^\n]+\n", "", analyses_path.read_text(encoding="utf-8"), count=1)
    analyses = markdown_html(analyses_markdown, BASE_URL + ROUTES["article-transcription-analyses"])
    analyses = analyses.replace(f'href="{BASE_URL}/', 'href="/')
    analyses = re.sub(r'<(/?)h([2-5])>', lambda match: f'<{match.group(1)}h{int(match.group(2)) + 1}>', analyses)
    (SOURCE / "data" / "transcription-analyses.html").write_text(analyses, encoding="utf-8")
    placeholder = '<div class="help-page" id="transcription-analyses-content"></div>'
    source = source.replace(placeholder, '<div class="help-page" id="transcription-analyses-content">' + analyses + '</div>')

    panels = {match.group(1): match.group(0) for match in PANEL.finditer(source)}
    if set(panels) != set(ROUTES):
        raise ValueError(f"Маршруты и разделы не совпадают: {set(panels) ^ set(ROUTES)}")

    translation_data = SOURCE / "data" / "author-translations.json"
    translation_data.write_text(json.dumps(translations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    purpose_data = SOURCE / "data" / "transcription-purposes.json"
    purpose_data.write_text(json.dumps(purposes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    calendar_transcriptions = {}
    for relative in sorted(published_paths):
        markdown = source_markdowns[relative]
        entry = calendar_entry(relative, markdown, source, by_source.get(relative))
        entry.setdefault("bodyText", original_transcription(markdown) or resolved_copy_texts[relative])
        calendar_transcriptions[SOURCE_URL + relative] = {
            "entry": entry,
            "originalText": original_transcription(markdown) or resolved_copy_texts[relative] or entry.get("bodyText", ""),
            "copyText": resolved_copy_texts[relative],
            "purposeHtml": purposes[relative],
            "purposeText": " ".join(html.unescape(re.sub(r'<[^>]+>', ' ', purposes[relative])).split()),
            "translationHtml": translations[relative],
            "pageUrl": transcription_route(ROOT / relative),
            "acquisitionType": acquisition_types[relative],
        }
        commentary = commentary_markdown(markdown)
        if commentary:
            calendar_transcriptions[SOURCE_URL + relative]["commentaryHtml"] = markdown_html(
                commentary, SOURCE_URL + relative, nested_lists=True
            )
    (SOURCE / "data" / "calendar-transcriptions.json").write_text(
        json.dumps(calendar_transcriptions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    with zipfile.ZipFile(SOURCE / "data" / "translation_materials.zip", "w") as archive:
        for name, content in archive_contents.items():
            # Фиксированные метаданные сохраняют одинаковый хеш архива при неизменных исходниках
            archive_entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            archive_entry.create_system = 0
            archive.writestr(archive_entry, content, compress_type=zipfile.ZIP_DEFLATED)

    shutil.copytree(SOURCE / "assets", OUTPUT / "assets", dirs_exist_ok=True)
    # BOM у опубликованной копии позволяет браузеру определить UTF-8 без HTTP charset
    published_theory = OUTPUT / "assets" / "documents" / "self-writing-generative-archive.md"
    theory_bytes = published_theory.read_bytes()
    if not theory_bytes.startswith(b"\xef\xbb\xbf"):
        published_theory.write_bytes(b"\xef\xbb\xbf" + theory_bytes)

    # Прежняя ссылка на теорию остаётся доступной после перехода на английский URL
    shutil.copyfile(
        published_theory,
        OUTPUT / "assets" / "documents" / "Теория_канала_самопишущийся_генеративный_архив.md",
    )
    shutil.copytree(SOURCE / "data", OUTPUT / "data", dirs_exist_ok=True)
    # BOM сообщает браузеру кодировку TXT, если хостинг не передаёт HTTP charset
    published_abbreviations = OUTPUT / "data" / "dictionary_of_abbreviations.txt"
    abbreviations_bytes = published_abbreviations.read_bytes()
    if not abbreviations_bytes.startswith(b"\xef\xbb\xbf"):
        published_abbreviations.write_bytes(b"\xef\xbb\xbf" + abbreviations_bytes)

    verification_file = SOURCE / "yandex_1195bbe61e0c2002.html"
    shutil.copyfile(verification_file, OUTPUT / verification_file.name)
    llms_file = SOURCE / "llms.txt"
    shutil.copyfile(llms_file, OUTPUT / llms_file.name)
    ai_directory = OUTPUT / ROUTES["for-ai"].lstrip("/")
    ai_directory.mkdir(parents=True, exist_ok=True)
    (ai_directory / "index.md").write_text(ai_page_markdown(ai_panel, by_source, resolved_copy_texts), encoding="utf-8")
    dictionary_directory = OUTPUT / "dictionaries"
    dictionary_directory.mkdir(parents=True, exist_ok=True)
    for path, filename, legacy_filename, route in (
        (dictionary_path, "words.md", "dictionary.md", ROUTES["dictionary-words"]),
        (methodology_path, "methodology.md", "dictionary-methodology.md", ROUTES["dictionary-words"]),
        (suffix_path, "suffixes.md", "suffixes.md", ROUTES["dictionary-suffixes"]),
        (suffix_methodology_path, "suffix-methodology.md", "suffix-methodology.md", ROUTES["dictionary-suffixes"]),
    ):
        shutil.copyfile(path, dictionary_directory / filename)
        pointer = ("# Current dictionary material\n\n"
                   f"[Current page]({BASE_URL}{route})\n\n"
                   f"[Current Markdown]({BASE_URL}/dictionaries/{filename})\n")
        (ai_directory / legacy_filename).write_text(pointer, encoding="utf-8")
    sources = [SOURCE / "index.html", verification_file, llms_file, Path(__file__), Path(__file__).with_name("transcription_sections.py"), dictionary_path, methodology_path,
               suffix_path, suffix_methodology_path, abbreviations_path, analyses_path, reaction_manifest_path]
    sources.extend(sources_for_purposes)
    sources.extend(path for folder in ("assets", "data") for path in (SOURCE / folder).rglob("*") if path.is_file())
    urls = []
    for panel_id, route in ROUTES.items():
        panel = PUBLISHED_LINK.sub(lambda match: f'href="{transcription_route(ROOT / match.group(1))}"', panels[panel_id])
        title_match = re.search(r'data-title="([^"]+)"', panel)
        title = title_match.group(1) if title_match else panel_id
        description_match = re.search(r'\bdata-description="([^"]+)"', panel.split(">", 1)[0])
        if description_match:
            description = html.unescape(description_match.group(1))
        else:
            description = re.sub(r'<[^>]+>', ' ', panel)
            description = re.sub(r'\s+', ' ', description).strip()[:155]
        markdown_route = {
            "for-ai": route + "index.md",
            "dictionary-words": "/dictionaries/words.md",
            "dictionary-suffixes": "/dictionaries/suffixes.md",
        }.get(panel_id, "")
        page = html_document(source, panel, panel_id, title, description, route, markdown_route)
        path = page_path(route)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(page, encoding="utf-8")
        urls.append(BASE_URL + route)

    for relative in sorted(published_paths):
        if not relative.startswith("docs/transcriptions/"):
            raise ValueError(f"Неизвестный источник: {relative}")
        source_path = ROOT / relative
        if not source_path.is_file() or not source_path.is_relative_to(ROOT / "docs" / "transcriptions"):
            raise ValueError(f"Нет исходника: {source_path}")
        sources.append(source_path)
        entry = by_source.get(relative, {})
        source_url = SOURCE_URL + relative
        route = transcription_route(source_path)
        markdown = source_path.read_text(encoding="utf-8")
        heading = re.search(r'^#\s+(.+)$', markdown, re.M)
        title = entry.get("title") or (heading.group(1) if heading else source_path.stem)
        copy_text = resolved_copy_texts[relative]
        has_commentary = bool(commentary_markdown(markdown))
        has_nested_translation = re.search(r'(?m)^[ \t]{2,}[-*] ', author_translation_markdown(markdown)) is not None
        analysis = markdown_html(markdown, source_url, nested_lists=has_commentary or has_nested_translation)
        copy_block = ""
        if copy_text:
            copy_block = (
                '<div class="sos-item-body">'
                '<details class="transcription-purpose"><summary>предполагаемое назначение</summary>'
                f'<div class="transcription-purpose-body">{purposes[relative]}</div></details>'
                f'<textarea id="transcription-copy" aria-label="Текст для копирования" readonly rows="5">{html.escape(copy_text)}</textarea>'
                f'<p class="analysis-mode">{analysis_label(analysis_modes[relative])}</p>'
                '<details class="author-translation"><summary>предполагаемый перевод</summary>'
                f'<div class="author-translation-body">{translations[relative]}</div></details>'
                '<div class="sos-actions"><button type="button" data-copy-target="transcription-copy">Скопировать</button>'
                '<span data-copy-status role="status"></span></div></div>'
            )
        date_from_source = re.search(r'(?:Дата и время получения транскрипции:|\*\*Дата получения:\*\*)\s*([^\n]+)', markdown)
        date_note = entry.get("dateNote") or (date_from_source.group(1).strip() if date_from_source else "не указана")
        panel = (
            '<section class="content-panel is-active" id="transcription" data-panel '
            f'data-title="{html.escape(title, quote=True)}">'
            f'<a class="help-back" href="/calendar/">← Новые транскрипции</a>'
            '<div class="section-heading">'
            f'<h2 class="transcription-heading-row"><span class="transcription-heading">{html.escape(title)}</span>{acquisition_icon(acquisition_types[relative])}</h2>'
            f'<p class="section-lead">Дата: {html.escape(date_note)}</p>'
            '</div><article class="entry-card" itemscope itemtype="https://schema.org/CreativeWork">'
            f'<meta itemprop="name" content="{html.escape(title, quote=True)}">'
            '<meta itemprop="inLanguage" content="ru">'
            f'<link itemprop="isBasedOn" href="{html.escape(source_url, quote=True)}">'
            '<p class="entry-meta">Источник транскрипции: автор.</p>'
            f'<p class="entry-status">{html.escape(entry.get("statusNote", ""))}</p>'
            f'{copy_block}'
            f'{reaction_placeholder(reaction_keys[relative], title)}'
            f'<div class="transcription-analysis">{analysis}</div>'
            f'<p><a href="{html.escape(source_url, quote=True)}" target="_blank" rel="noopener noreferrer">Исходный Markdown на GitHub ↗</a></p>'
            f'{chat_markup(reaction_keys[relative], chat_template)}'
            '</article></section>'
        )
        page = html_document(source, panel, "transcription", title, (entry.get("bodyText") or title)[:155], route, route + "index.md")
        path = page_path(route)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(page, encoding="utf-8")
        shutil.copyfile(source_path, path.with_suffix(".md"))
        # Исходные относительные ссылки словаря требуют копии по пути Markdown-файла
        shutil.copyfile(source_path, OUTPUT / relative.removeprefix("docs/"))
        urls.append(BASE_URL + route)

    # Прежние адреса удалённых общих копий ведут к единственному тематическому разбору
    for previous, retained in TRANSCRIPTION_REDIRECTS.items():
        if retained not in published_paths:
            raise ValueError(f"Нет опубликованного разбора для прежнего адреса: {retained}")
        route = transcription_route(ROOT / previous)
        target_route = transcription_route(ROOT / retained)
        target_url = BASE_URL + target_route
        redirect = (
            '<!doctype html>\n<html lang="ru"><head><meta charset="utf-8">'
            f'<meta http-equiv="refresh" content="0;url={html.escape(target_route, quote=True)}">'
            f'<link rel="canonical" href="{html.escape(target_url, quote=True)}">'
            '<meta name="robots" content="noindex,follow"><title>Разбор перенесён</title></head><body>'
            f'<p>Разбор перенесён в тематический раздел. <a href="{html.escape(target_route, quote=True)}">Открыть разбор</a></p>'
            '</body></html>\n'
        )
        pointer = f"# Разбор перенесён\n\n[Открыть единственный тематический разбор]({target_url})\n"
        path = page_path(route)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(redirect, encoding="utf-8")
        path.with_suffix(".md").write_text(pointer, encoding="utf-8")
        (OUTPUT / previous.removeprefix("docs/")).write_text(pointer, encoding="utf-8")

    manifest = {str(path.relative_to(ROOT)).replace("\\", "/"): digest_file(path) for path in sorted(set(sources))}
    manifest_text = json.dumps({"schema": 1, "sources": manifest}, ensure_ascii=False, indent=2) + "\n"
    (OUTPUT / "content-manifest.json").write_text(manifest_text, encoding="utf-8")
    (ROOT / "site" / "content-manifest.json").write_text(manifest_text, encoding="utf-8")
    (OUTPUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {BASE_URL}/sitemap.xml\n", encoding="utf-8")
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += "".join(f"  <url><loc>{html.escape(url)}</loc></url>\n" for url in urls)
    (OUTPUT / "sitemap.xml").write_text(sitemap + "</urlset>\n", encoding="utf-8")
    print(f"Собрано {len(ROUTES)} разделов и {len(urls) - len(ROUTES)} транскрипций в {OUTPUT}")


if __name__ == "__main__":
    main()
