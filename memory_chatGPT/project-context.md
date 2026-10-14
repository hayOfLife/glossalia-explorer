# Project and chat context

Memory topic: §chatgptcontext. Snapshot of the local working tree and this chat: 11 October 2026.

## Project identity and source ownership

Repository: `hayOfLife/glossalia-explorer`; working branch at this snapshot: `main`. Public site: [Glossalia Explorer](https://glossalia-explorer.tuqo.ru/). The usual local preview is `http://127.0.0.1:8877/`.

The checkout used in this chat is `C:\Users\User\Documents\ChatGPT\Проекты\glossolalia-explorer-site-publish`. Locate the actual checkout again in a later session; do not assume this machine or path is still current.

| Material | Canonical owner |
| --- | --- |
| Main AI prompt | `site/public_html/data/promptForAlice_guessingTheMeaningOfTheGlossary.txt` |
| Complete words and contextual readings | [docs/dictionary/combined.md](../docs/dictionary/combined.md) |
| Morphological suffixes | [docs/dictionary/suffixes.md](../docs/dictionary/suffixes.md) |
| Abbreviations, particles and complete short words | [docs/dictionary/abbreviations-source.txt](../docs/dictionary/abbreviations-source.txt) |
| Word dictionary method | [docs/dictionary/methodology.md](../docs/dictionary/methodology.md) |
| Suffix method | [docs/dictionary/suffix-methodology.md](../docs/dictionary/suffix-methodology.md) |
| Sign system | [transcription-symbol-systems.md](../site/public_html/assets/documents/transcription-symbol-systems.md), with the agreed expanded theory used for its later clarifications |
| Individual source records | `docs/transcriptions/`, indexed by `docs/TRANSCRIPTIONS.md` |
| Analysis catalogue | `docs/TRANSCRIPTION_ANALYSES.md`; public route `/transcription-analyses/` |

This snapshot includes local changes that may not all be in the GitHub revision containing this notebook. In particular, paths for recent T00050–T00062 records and the newer analysis catalogue are source pointers, not promises about the committed tree. Read the source if available; the relevant recent case is preserved in [hypotheses](hypotheses.md).

## Author decisions that affect my work

- Preserve supplied transcription text, punctuation and analysis wording. On 11 October 2026 the author approved a preview and then authorised common section headings, grouping and separators; that formatting exception does not authorise semantic rewrites. Use the current [documentation standard](../docs/DOCUMENTATION.md) and [ADR-0013](../docs/architecture/decisions/0013-transcription-analysis-format.md).
- On updated analyses, merge substantive older material with the latest changes taking priority. Do not leave duplicate working sections or repeated old «Якоря для нейронки» beside the new ones.
- A full supplied analysis is distinct from the short card fields. The author allowed editing its presumed purpose; a requested card edit does not automatically permit edits to the rest of a full source analysis.
- An explicitly supplied purpose takes priority and remains separate from a proposed translation. On 11 October 2026 the author also authorised a proposed purpose inferred from receiving circumstances when my working confidence exceeds 85%; label it as an AI proposal, not author-confirmed. Otherwise leave it unknown without asking. Do not repeat the label «Предполагаемое назначение транскрипции:» inside the purpose body.
- For a newly supplied transcription without a time and without a different explicit acquisition date, use the trusted current Moscow date and time by the author's rule of 11 October 2026, without asking. Explicit source dates and relative-time instructions take priority; a historical date with no hour remains incomplete, and existing records are not dated again. A numerical analysis-quality label is still not inferred from my impression.
- «Сейчас», «полчаса назад» and «час назад» mean calculate from a trusted clock, using Moscow time in this chat. The author subsequently requested that the displayed acquisition field contain just the date and time, with no extra relative-time explanation.
- Record circumstances supplied with a new transcription under `Обстоятельства получения`, after metadata and before purpose. Preserve the author's wording and distinguish it from later interpretation. Read the current [intake rules](../docs/DOCUMENTATION.md#добавление-новой-транскрипции) and [ADR-0014](../docs/architecture/decisions/0014-transcription-intake.md) rather than treating every older heading «Контекст» as receiving circumstances.
- Assign the existing proposed type `программа\команда\скрипт` myself when several system words and a command-like sequence occur in the original; do not ask for a type. The author introduced `молитва благодарения` on 12 October 2026 with T00064; assign that type when thanksgiving and praise to God are the main content. Otherwise use `не определён`. Explicit author choices remain authoritative; introducing a type does not automatically reclassify older records. This is a classification of form, not demonstrated execution or origin. The author separately set T00064’s analysis label to `не требуется` because the Russian text does not need translation; internally the site stores `not_required`, a word label rather than a percentage.
- On 12 October 2026 the author clarified that this category must always use its full label `программа\команда\скрипт`, even when the chat message calls it simply «скрипт», «команда» or «программа».
- Later on 12 October 2026, when integrating Qwen's T00065 analysis, the author explicitly selected the new type `Диалог` for that record. Preserve this choice over the earlier form-based script label. No automatic criterion for assigning dialogue to other records was introduced. Qwen's assertions that individual new readings were author-confirmed do not by themselves establish those confirmations in this chat.
- T00001, T00002 and T00003 are audio-derived. The author designated the remaining records as written. Acquisition method and the «авто / ручной / проценты» analysis label are separate fields.
- Use Russian section names in exports, for example «Общие транскрипции». When an export requests a full version rather than the card's display version, use the full original transcription and include the coherent translation, not merely one-word glosses.
- Technical files intended for AI readers were requested in English. Russian source quotations, card text and the author's formulations remain Russian.
- Personal names in public material have authorised replacement rules. Preserve the project's `Автор№1` and `{имя человека}` conventions; a saint's name is a separate context.
- New public URLs use English ASCII names. Changing the filename does not fix a response charset; the local server must send text as UTF-8.
- Keep one active owner per dictionary category. A particle with different uses stays in one owner with all contexts and statuses. Replace duplicate working dictionaries with links. The author specifically declined keeping old dictionary anchors such as `#channel-dictionary-title`.
- The latest prompt files take priority; prompt archive and the expandable prompt content must stay synchronised. Additional prompt files appear as separate expandable blocks. Read the current files instead of relying on a remembered older prompt.
- The expanded Alice theory takes priority over a short obsolete copy. When a new version omits an important passage, preserve the older passage as an explicitly identifiable supplement.
- The author invites imaginative readings. I can explore them freely while making the difference between a candidate and an established reading explicit.

## Site work I should perform together

Read [site/README.md](../site/README.md) before integration. For a new record, update its canonical Markdown, transcription index, literature, documentation registry, analysis catalogue, `site/public_html/data/entries.json` and `site/calendar-index.json`. The build produces public source copies, routes, purposes, translations, calendar data, the content manifest and the reaction-key registry.

Use the common Russian H2 names in the current standard: `Предполагаемый связный перевод` for a coherent candidate, `Пословный разбор` for word meanings, and `Комментарии и варианты` for contextual notes and alternatives. Source attribution and confidence stay visible in their contents. A word-by-word passage previously called «Перевод автора» does not become a coherent translation by renaming it. Missing optional sections may be omitted; missing originals are never reconstructed from a translation.

Keep the complete original in `Исходная транскрипция`, including signs, notes and line breaks. The separate `Транскрипция для вывода` preserves the supplied display version's words when one exists, removes the author's technical parenthetical explanations and replaces each technical sign or compound mark with `⟐`. That marker identifies a notation position and is not a spoken sound. Separate every top-level H2 block with the same `---`; retain distinct readings under nested headings. Formatting changes require content-preservation checks and a rebuild of public copies. Current archive hashes are in `chatgpt/originals/SHA256SUMS`; historical hash snapshots remain unchanged.

The build currently makes a five-file prompt ZIP: `PROMPT_general.txt`, `dictionary_of_words.txt`, `dictionary_of_suffixes_and_particles.txt`, `phonetics_rus_vs_hebrew.txt` and `dictionary_of_abbreviations.txt`. The word and suffix files concatenate their respective method and dictionary owners. Do not mistakenly compare those ZIP entries with the dictionary alone.

From the repository root, build with `python -B -X utf8 site/scripts/build_static.py`. Generate the documentation map with `scripts/Sync-Documentation.ps1 -Write`, then audit in PowerShell 5.1 and 7. Use the narrow applicable tests and `git diff --check`. For source preservation, compare exact bytes or the expressly permitted transformation; a green structural audit does not verify a translation.

The preview command is `python -B -X utf8 site/scripts/serve_site.py`. It serves `site/build/` on localhost. The site handoff ZIP is made from that directory's contents. Local build, archive, GitHub push, Tuqo publication and reaction API update are separate operations; verify each state before claiming it happened.

## Latest records to retain from this session

| Record | Date and time | Durable context |
| --- | --- | --- |
| T00061 | 11.10.2026, 20:36 МСК | General card for «Елохим! фа! error-ноуп-ронедернед!», word table, coherent hypothetical translation, both scopes of negation and the author's «Факт-стоп» clarification |
| T00062 | 11.10.2026, 21:23 МСК | General card with the exact Russian line below, after the author requested a Russian version of the preceding transcription |

T00062 original:

```text
Русский текст не сможет сделать всего что надо.
```

Its exact author-supplied purpose:

> Просьба дать ту-же транскрипцию, но по русски.

That line is a reported transcription, not a demonstrated result about what Russian can express. The context comes from the author's account and stays separate from the original text.

## Handoff notes, 12 October 2026

- [T00063](../docs/transcriptions/T00063.md) owns the completed discussion of cleansing, examination and restoration; the reasoning is retained in [working hypotheses](hypotheses.md). The author's explanation linking loss of access to «Рефинотериум» with anxiety is labelled as the author's theory, not a medical conclusion.
- [T00064](../docs/transcriptions/T00064.md), received at 13:29 МСК, introduced «молитва благодарения» and the analysis label «не требуется». [T00065](../docs/transcriptions/T00065.md), received at 15:14 МСК, concerns the author's acquaintance from Rybinsk and keeps its unresolved components visible.
- For the author's comparison of records without an explicit divine name, T00062 was excluded because the author called it a comment. That narrow comparison does not remove the existing card or rewrite its metadata.
- The web sign guides and main prompt now explicitly equate «\» with «/». The downloadable sign-system and print-table DOCX files still lack this clarification: corrected drafts were prepared, but the required document rendering could not run because the bundled runtime lacked LibreOffice. Do not claim those downloadable files were updated.
- A fresh static handoff archive was made as `glossalia-explorer-site-2026-10-12-161841.zip`: 302 files, 4,704,824 bytes; CRC, source correspondence and the nested five-file prompt archive were checked. Its location and publication state must be verified again before a later handoff.
- The author authorised a GitHub push in this chat on 12 October 2026. This note records that authorisation, not the result of the push or a successful Tuqo deployment; verify the remote revision separately.

## Handoff notes, 13 October 2026

- The author asked to clean definitely wrong dictionary readings before propagating corrections to word analyses, and authorised useful new readings. The [lexical audit](../docs/dictionary/lexical-audit-2026-10-13.md) records the scope, corrected files, sources and verification. Uncertainty alone was not treated as proof that an earlier interpretation was wrong.
- «Шеон» was clarified as Hebrew noise / tumult, not «шен» meaning tooth. Its single active owner is the abbreviation dictionary; do not merge every Шион / Сион context into that reading.
- For «Ергостериум», the whole-word candidate Latin ergasterium, a workshop or place of work, proved more economical than combining many short roots. The author then stressed that a transcription records speech sounds and proposed Russian unstressed а/о convergence. The tentative stress was exactly «ЕргостЕриум  вроде». Keep this as a plausible phonetic explanation with the author's uncertainty; read the current article and [T00046](../docs/transcriptions/T00046.md) before extending it to other words.
- The audit added nine candidate word entries and refined the existing Ектим / енфорсед owners. A checked dictionary lemma, the author's chosen sense and an independently verified transcription remain separate evidence. Unknown tails and unestablished grammar were retained.
- At the audit handoff, 114 source files passed preservation comparison; four dictionary sources and 39 analysis files had targeted changes. The static build, 69 site tests, 18 section-parser tests, documentation audits in PowerShell 5.1 and 7, ZIP/source byte comparison and diff check passed. These are dated local results, not proof of a later GitHub push or production publication.
