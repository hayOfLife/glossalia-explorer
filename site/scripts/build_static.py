"""Собрать отдельные HTML-страницы из текущей оболочки и исходных Markdown."""

from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "site" / "public_html"
OUTPUT = ROOT / "site" / "build"
BASE_URL = "https://glossalia-explorer.tuqo.ru"
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
    "translation": "/translation/",
    "help": "/help/",
    "help-glossolalia": "/help/glossolalia/",
    "help-purpose": "/help/purpose/",
    "help-churches": "/help/churches/",
    "help-theories": "/help/theories/",
    "article-why-god-is-lord": "/articles/why-god-is-lord/",
    "article-glossolalia-hypothesis": "/articles/glossolalia-hypothesis/",
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


def html_document(source: str, panel: str, panel_id: str, title: str, description: str, route: str) -> str:
    matches = list(PANEL.finditer(source))
    if not matches:
        raise ValueError("Не найдены секции сайта")

    page = source[: matches[0].start()] + panel + source[matches[-1].end() :]
    page = page.replace('<body>', f'<body data-page-id="{panel_id}">', 1)
    page = re.sub(r'<title>.*?</title>', f'<title>{html.escape(title)} — Глоссалия</title>', page, count=1)
    page = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{html.escape(description, quote=True)}">', page, count=1)
    canonical = f'{BASE_URL}{route}'
    page = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{html.escape(title, quote=True)} — Глоссалия">', page, count=1)
    page = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{html.escape(description, quote=True)}">', page, count=1)
    page = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{canonical}">', page, count=1)
    page = page.replace('</head>', f'    <link rel="canonical" href="{canonical}">\n  </head>', 1)
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


def markdown_table(lines: list[str], source_url: str) -> str:
    rows = [[cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip()[1:-1])] for line in lines]
    if len(rows) < 2 or not rows[0] or not all(len(row) == len(rows[0]) for row in rows):
        return '<pre class="source-table">' + html.escape("\n".join(lines)) + "</pre>"
    if not all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1]):
        return '<pre class="source-table">' + html.escape("\n".join(lines)) + "</pre>"

    def cells(row: list[str], tag: str) -> str:
        scope = ' scope="col"' if tag == "th" else ""
        return "<tr>" + "".join(f"<{tag}{scope}>{inline(cell.replace(r'\|', '|'), source_url)}</{tag}>" for cell in row) + "</tr>"

    head = cells(rows[0], "th")
    body = "".join(cells(row, "td") for row in rows[2:])
    return f'<div class="source-table-wrap"><table class="source-table"><thead>{head}</thead><tbody>{body}</tbody></table></div>'


def markdown_html(text: str, source_url: str) -> str:
    """Преобразовать обычные блоки Markdown, оставляя сложные таблицы без потери текста."""
    text = re.sub(r"^разбор транскрипции: (?:авто|ручной, 100%|(?:100|[1-9]?\d)%)\s*\n", "", text, count=1)
    result: list[str] = []
    paragraph: list[str] = []
    listing = ""
    fence = False
    table: list[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            result.append("<p>" + inline(" ".join(paragraph), source_url) + "</p>")
            paragraph.clear()

    def flush_table() -> None:
        if table:
            result.append(markdown_table(table, source_url))
            table.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_paragraph()
            flush_table()
            if listing:
                result.append(f"</{listing}>")
                listing = ""
            result.append("</code></pre>" if fence else "<pre><code>")
            fence = not fence
            continue
        if fence:
            result.append(html.escape(line) + "\n")
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

    flush_paragraph()
    flush_table()
    if listing:
        result.append(f"</{listing}>")
    if fence:
        result.append("</code></pre>")
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
        key = keys.get(relative) or text_keys.get(text) or inline_keys.get(field.group(1))
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
    section = re.search(rf'^## {re.escape(heading)}\s*\n(.*?)(?=^## |\Z)', markdown, re.M | re.S | re.I)
    if not section:
        return ""
    lines = section.group(1).strip().splitlines()
    if lines and lines[0].strip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    lines = [re.sub(r'^\s*>\s?', '', line) for line in lines]
    return "\n".join(lines).strip()


def original_transcription(markdown: str) -> str:
    return transcription_section(markdown, "Необработанная транскрипция")


def translation_labels_html(content: str, source_url: str, transcription: str) -> str:
    rendered = markdown_html(content, source_url)

    def words(text: str) -> set[str]:
        return set(re.findall(r"[^\W\d_]+(?:[-‑][^\W\d_]+)*", text.casefold()))

    source_words = words(transcription)

    def source_label(text: str) -> bool:
        label_words = words(text) - {"или"}
        return bool(label_words) and all(
            word in source_words or any(
                len(word) >= 7 and len(source) >= 7 and word[0] == source[0]
                and SequenceMatcher(None, word, source).ratio() >= 0.9
                for source in source_words
            )
            for word in label_words
        )

    labels = []
    for paragraph in re.split(r"\n\s*\n", content):
        lines = paragraph.strip().splitlines()
        if not lines or lines[0].lstrip().startswith(("#", ">", "```", "|", "«", '"')):
            continue
        first = lines[0].strip()
        tag = "li" if first.startswith(("- ", "* ")) else "p"
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


def author_translation_html(markdown: str, source_url: str, copy_text: str = "") -> str:
    for heading in ("Перевод автора", "Авторский перевод", "Сводный перевод Автор№1", "Итоговый перевод", "Связный перевод", "Перевод (гипотеза)", "Всё послание связным текстом"):
        section = re.search(rf'^## {re.escape(heading)}(?:\s*\([^\n]*\))?\s*\n(.*?)(?=^## |\Z)', markdown, re.M | re.S | re.I)
        if section:
            content = section.group(1).strip().removesuffix("---").strip()
            if content:
                transcription = "\n".join((original_transcription(markdown), transcription_section(markdown, "Текст для копирования"), copy_text))
                return translation_labels_html(content, source_url, transcription)
    return '<p>Пока не заполнено</p>'


def purpose_html(source_path: Path) -> str:
    markdown = source_path.read_text(encoding="utf-8")
    section = re.search(r'^## Назначение\s*\n(.*?)(?=^## |\Z)', markdown, re.M | re.S | re.I)
    if section and section.group(1).strip():
        relative = source_path.relative_to(ROOT).as_posix()
        return markdown_html(section.group(1).strip(), SOURCE_URL + relative)
    return '<p>Пока не заполнено</p>'


def analysis_mode(markdown: str) -> str:
    marker = re.search(r"^разбор транскрипции: (авто|ручной, 100%|(?:100|[1-9]?\d)%)$", markdown, re.M)
    if marker:
        value = marker.group(1)
        return {"ручной, 100%": "manual", "авто": "auto"}.get(value, value)
    return "manual" if re.search(r"пометки\s+автора|\bуточнено\b", markdown, re.I) else "auto"


def analysis_label(mode: str) -> str:
    label = "100%" if mode == "manual" else mode if re.fullmatch(r"(?:100|[1-9]?\d)%", mode) else "авто"
    return "Разбор транскрипции: " + label


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
    transcription = values(("транскрипция", "слово", "ручная форма", "форма автора", "звук", "точная форма и движок", "ручная форма f7", "ручная форма и контекст")) or [title]
    engine_marker = r",\s*(ZIPA|W2V2|Allosaurus)\b"
    obtained = [engine for text in transcription for engine in re.findall(engine_marker, text)] or ["ручная"]
    transcription = [re.sub(engine_marker, "", text).strip() for text in transcription]

    dictionary = values(("перевод из словаря",))
    interpretation = values(("трактовка автора", "толкование автора", "авторское толкование", "образ пользователя"))
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


def dictionary_html(markdown: str, source_url: str) -> str:
    headings = list(re.finditer(r"^## (.+)$", markdown, re.M))
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

        rows.append('<tr>' + ''.join(cells) + '</tr>')
    return ('<div class="dictionary-table-wrap"><table class="dictionary-table" aria-labelledby="channel-dictionary-title">'
            '<thead><tr>' + ''.join(f'<th scope="col">{label}</th>' for label in labels) + '</tr></thead>'
            '<tbody>' + ''.join(rows) + '</tbody></table></div>')


def main() -> None:
    source = (SOURCE / "index.html").read_text(encoding="utf-8")
    chat_template_match = CHAT_TEMPLATE.search(source)
    if not chat_template_match:
        raise ValueError("Не найден шаблон комментариев")
    chat_template = chat_template_match.group(1)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    translation_sources = {match.group(1) for match in AUTHOR_TRANSLATION.finditer(source) if match.group(1)}
    purpose_sources = {match.group(1) for match in PURPOSE_PLACEHOLDER.finditer(source) if match.group(1)}
    entries = json.loads((SOURCE / "data" / "entries.json").read_text(encoding="utf-8"))
    by_source = {entry["sourceUrl"].removeprefix(SOURCE_URL): entry for entry in entries if entry.get("published")}
    text_for_copy = copy_texts(source)
    published_paths = set(by_source) | set(text_for_copy)
    reaction_keys = {relative: reaction_key(relative, by_source.get(relative)) for relative in sorted(published_paths)}
    if len(set(reaction_keys.values())) != len(reaction_keys):
        raise ValueError("Разные транскрипции имеют одинаковый ключ голосования")
    source, inline_reaction_keys = attach_block_reactions(source, reaction_keys, text_for_copy)
    reaction_manifest_path = ROOT / "site/reactions-api/transcriptions.json"
    reaction_manifest_path.write_text(json.dumps({"schema": 1, "keys": sorted(set(reaction_keys.values()) | inline_reaction_keys)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    analysis_modes = {}
    translations = {}
    purposes = {}
    resolved_copy_texts = {}
    sources_for_purposes: set[Path] = set()
    for relative in sorted(published_paths | translation_sources | purpose_sources):
        source_path = ROOT / relative
        if not relative.startswith("docs/transcriptions/") or not source_path.is_file() or not source_path.is_relative_to(ROOT / "docs" / "transcriptions"):
            raise ValueError(f"Нет исходника перевода: {relative}")
        markdown = source_path.read_text(encoding="utf-8")
        entry = by_source.get(relative, {})
        resolved_copy_texts[relative] = (entry.get("copyText") or transcription_section(markdown, "Текст для копирования")
                                         or text_for_copy.get(relative) or original_transcription(markdown) or entry.get("bodyText", ""))
        analysis_modes[relative] = analysis_mode(markdown)
        translations[relative] = author_translation_html(markdown, SOURCE_URL + relative, text_for_copy.get(relative, ""))
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
    (SOURCE / "index.html").write_text(source, encoding="utf-8")

    source = re.sub(
        r'<p class="analysis-mode" data-analysis-source="([^"]*)">.*?</p>',
        lambda match: '<p class="analysis-mode">' + analysis_label(analysis_modes.get(match.group(1), "auto")) + '</p>',
        source,
    )
    for entry in entries:
        relative = entry.get("sourceUrl", "").removeprefix(SOURCE_URL)
        entry["analysisMode"] = analysis_modes.get(relative, "auto")
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
        if not document.is_file() or document.suffix.lower() != ".txt" or not document.is_relative_to(SOURCE / "assets" / "documents"):
            raise ValueError(f"Нет публичного текстового документа: {relative}")
        return '<div class="help-page">' + plain_document_html(document.read_text(encoding="utf-8-sig")) + '</div>'

    source = DOCUMENT_PLACEHOLDER.sub(insert_document, source)
    dictionary_path = ROOT / "docs" / "dictionary" / "combined.md"
    dictionary = dictionary_html(dictionary_path.read_text(encoding="utf-8"), SOURCE_URL + "docs/dictionary/combined.md")
    (SOURCE / "data" / "dictionary.html").write_text(dictionary, encoding="utf-8")
    source = source.replace('<div id="channel-dictionary-content"></div>', '<div id="channel-dictionary-content">' + dictionary + '</div>')
    panels = {match.group(1): match.group(0) for match in PANEL.finditer(source)}
    if set(panels) != set(ROUTES):
        raise ValueError(f"Маршруты и разделы не совпадают: {set(panels) ^ set(ROUTES)}")

    translation_data = SOURCE / "data" / "author-translations.json"
    translation_data.write_text(json.dumps(translations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    purpose_data = SOURCE / "data" / "transcription-purposes.json"
    purpose_data.write_text(json.dumps(purposes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    calendar_transcriptions = {
        entry["sourceUrl"]: {
            "copyText": resolved_copy_texts[relative],
            "purposeHtml": purposes[relative],
            "translationHtml": translations[relative],
            "pageUrl": transcription_route(ROOT / relative),
        }
        for relative, entry in by_source.items()
        if entry.get("type") in {"manual_transcription", "analysis"}
    }
    (SOURCE / "data" / "calendar-transcriptions.json").write_text(
        json.dumps(calendar_transcriptions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    shutil.copytree(SOURCE / "assets", OUTPUT / "assets", dirs_exist_ok=True)
    shutil.copytree(SOURCE / "data", OUTPUT / "data", dirs_exist_ok=True)
    verification_file = SOURCE / "yandex_1195bbe61e0c2002.html"
    shutil.copyfile(verification_file, OUTPUT / verification_file.name)
    sources = [SOURCE / "index.html", verification_file, Path(__file__), dictionary_path, reaction_manifest_path]
    sources.extend(sources_for_purposes)
    sources.extend(path for folder in ("assets", "data") for path in (SOURCE / folder).rglob("*") if path.is_file())
    urls = []
    for panel_id, route in ROUTES.items():
        panel = PUBLISHED_LINK.sub(lambda match: f'href="{transcription_route(ROOT / match.group(1))}"', panels[panel_id])
        title_match = re.search(r'data-title="([^"]+)"', panel)
        title = title_match.group(1) if title_match else panel_id
        description = re.sub(r'<[^>]+>', ' ', panel)
        description = re.sub(r'\s+', ' ', description).strip()[:155]
        page = html_document(source, panel, panel_id, title, description, route)
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
        analysis = markdown_html(markdown, source_url)
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
            f'<h2>{html.escape(title)}</h2>'
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
        page = html_document(source, panel, "transcription", title, (entry.get("bodyText") or title)[:155], route)
        path = page_path(route)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(page, encoding="utf-8")
        urls.append(BASE_URL + route)

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
