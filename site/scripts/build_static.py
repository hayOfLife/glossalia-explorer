"""Собрать отдельные HTML-страницы из текущей оболочки и исходных Markdown."""

from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
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
    "translation": "/translation/",
    "help": "/help/",
    "help-glossolalia": "/help/glossolalia/",
    "help-purpose": "/help/purpose/",
    "help-churches": "/help/churches/",
    "help-theories": "/help/theories/",
    "help-ai": "/help/ai/",
    "help-author": "/help/author/",
    "donate": "/donate/",
    "for-ai": "/for-ai/",
}
PANEL = re.compile(r'<section class="content-panel[^\"]*" id="([^\"]+)"[^>]*>.*?</section>', re.S)
LOCAL_LINK = re.compile(r'href="#([a-z0-9-]+)"')
SOURCE_URL = "https://github.com/hayOfLife/glossalia-explorer/blob/main/"
PUBLISHED_LINK = re.compile(r'href="https://github\.com/hayOfLife/glossalia-explorer/blob/main/(docs/transcriptions/[^"]+\.md)"')
AUTHOR_TRANSLATION = re.compile(r'<div class="author-translation-body" data-author-translation="([^"]*)"></div>')
PURPOSE_PLACEHOLDER = re.compile(r'<div class="transcription-purpose-body" data-purpose-source="([^"]*)"></div>')


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
    escaped = re.sub(r'\[([^]]+)\]\(([^)]+)\)', lambda match: f'<a href="{html.escape(source_link(match.group(2), source_url), quote=True)}">{match.group(1)}</a>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', escaped)
    escaped = re.sub(r'`([^`]+)`', r'<code>\1</code>', escaped)
    return escaped


def source_link(target: str, source_url: str) -> str:
    if target.startswith(("https://", "http://", "#")):
        return target
    resolved = urljoin(source_url, quote(target))
    return resolved if urlparse(resolved).scheme == "https" else "#"


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
    result: list[str] = []
    paragraph: list[str] = []
    listing = False
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
                result.append("</ul>")
                listing = False
            result.append("</code></pre>" if fence else "<pre><code>")
            fence = not fence
            continue
        if fence:
            result.append(html.escape(line) + "\n")
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            table.append(line)
            continue
        flush_table()
        if not stripped:
            flush_paragraph()
            if listing:
                result.append("</ul>")
                listing = False
            continue
        heading = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if heading:
            flush_paragraph()
            if listing:
                result.append("</ul>")
                listing = False
            level = min(len(heading.group(1)) + 1, 6)
            result.append(f'<h{level}>{inline(heading.group(2), source_url)}</h{level}>')
            continue
        if re.fullmatch(r'-{3,}|\*{3,}', stripped):
            flush_paragraph()
            result.append("<hr>")
            continue
        if stripped.startswith(("- ", "* ")):
            flush_paragraph()
            if not listing:
                result.append("<ul>")
                listing = True
            result.append("<li>" + inline(stripped[2:], source_url) + "</li>")
            continue
        if listing:
            result.append("</ul>")
            listing = False
        if stripped.startswith("> "):
            flush_paragraph()
            result.append("<blockquote>" + inline(stripped[2:], source_url) + "</blockquote>")
            continue
        paragraph.append(stripped)

    flush_paragraph()
    flush_table()
    if listing:
        result.append("</ul>")
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


def author_translation_html(markdown: str, source_url: str) -> str:
    for heading in ("Перевод автора", "Авторский перевод", "Итоговый перевод", "Связный перевод", "Перевод (гипотеза)"):
        section = re.search(rf'^## {re.escape(heading)}(?:\s*\([^\n]*\))?\s*\n(.*?)(?=^## |\Z)', markdown, re.M | re.S | re.I)
        if section:
            content = section.group(1).strip().removesuffix("---").strip()
            if content:
                return markdown_html(content, source_url)
    return '<p>Пока не заполнено</p>'


def purpose_html(source_path: Path) -> str:
    markdown = source_path.read_text(encoding="utf-8")
    section = re.search(r'^## Назначение\s*\n(.*?)(?=^## |\Z)', markdown, re.M | re.S | re.I)
    if section and section.group(1).strip():
        relative = source_path.relative_to(ROOT).as_posix()
        return markdown_html(section.group(1).strip(), SOURCE_URL + relative)
    return '<p>Пока не заполнено</p>'


def main() -> None:
    source = (SOURCE / "index.html").read_text(encoding="utf-8")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    translation_sources = {match.group(1) for match in AUTHOR_TRANSLATION.finditer(source) if match.group(1)}
    purpose_sources = {match.group(1) for match in PURPOSE_PLACEHOLDER.finditer(source) if match.group(1)}
    entries = json.loads((SOURCE / "data" / "entries.json").read_text(encoding="utf-8"))
    by_source = {entry["sourceUrl"].removeprefix(SOURCE_URL): entry for entry in entries if entry.get("published")}
    text_for_copy = copy_texts(source)
    published_paths = set(by_source) | set(text_for_copy)
    translations = {}
    purposes = {}
    sources_for_purposes: set[Path] = set()
    for relative in sorted(published_paths | translation_sources | purpose_sources):
        source_path = ROOT / relative
        if not relative.startswith("docs/transcriptions/") or not source_path.is_file() or not source_path.is_relative_to(ROOT / "docs" / "transcriptions"):
            raise ValueError(f"Нет исходника перевода: {relative}")
        markdown = source_path.read_text(encoding="utf-8")
        translations[relative] = author_translation_html(markdown, SOURCE_URL + relative)
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

    source = AUTHOR_TRANSLATION.sub(insert_translation, source)
    source = PURPOSE_PLACEHOLDER.sub(insert_purpose, source)
    panels = {match.group(1): match.group(0) for match in PANEL.finditer(source)}
    if set(panels) != set(ROUTES):
        raise ValueError(f"Маршруты и разделы не совпадают: {set(panels) ^ set(ROUTES)}")

    translation_data = SOURCE / "data" / "author-translations.json"
    translation_data.write_text(json.dumps(translations, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    purpose_data = SOURCE / "data" / "transcription-purposes.json"
    purpose_data.write_text(json.dumps(purposes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copytree(SOURCE / "assets", OUTPUT / "assets", dirs_exist_ok=True)
    shutil.copytree(SOURCE / "data", OUTPUT / "data", dirs_exist_ok=True)
    verification_file = SOURCE / "yandex_1195bbe61e0c2002.html"
    shutil.copyfile(verification_file, OUTPUT / verification_file.name)
    sources = [SOURCE / "index.html", verification_file, Path(__file__)]
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
        copy_text = (entry.get("copyText") or transcription_section(markdown, "Текст для копирования")
                     or text_for_copy.get(relative) or original_transcription(markdown) or entry.get("bodyText", ""))
        analysis = markdown_html(markdown, source_url)
        copy_block = ""
        if copy_text:
            copy_block = (
                '<div class="sos-item-body">'
                '<details class="transcription-purpose"><summary>предполагаемое назначение</summary>'
                f'<div class="transcription-purpose-body">{purposes[relative]}</div></details>'
                f'<textarea id="transcription-copy" aria-label="Текст для копирования" readonly rows="5">{html.escape(copy_text)}</textarea>'
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
            f'<a class="help-back" href="/calendar/">← Календарь</a>'
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
            f'<div class="transcription-analysis">{analysis}</div>'
            f'<p><a href="{html.escape(source_url, quote=True)}" target="_blank" rel="noopener noreferrer">Исходный Markdown на GitHub ↗</a></p>'
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
