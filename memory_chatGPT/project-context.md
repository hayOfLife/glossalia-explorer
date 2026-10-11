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

- Preserve supplied transcription text, punctuation and analysis verbatim. An author may explicitly correct a word; that permission does not authorise rewriting the rest.
- On updated analyses, merge substantive older material with the latest changes taking priority. Do not leave duplicate working sections or repeated old «Якоря для нейронки» beside the new ones.
- A full supplied analysis is distinct from the short card fields. The author allowed editing its presumed purpose; a requested card edit does not automatically permit edits to the rest of a full source analysis.
- Purpose is what the author says the prayer is for. It is separate from a proposed translation. Do not repeat the label «Предполагаемое назначение транскрипции:» inside the purpose body.
- If purpose, time or a numerical analysis label has not been supplied, leave it unknown. Do not invent a confidence percentage from my impression.
- «Сейчас», «полчаса назад» and «час назад» mean calculate from a trusted clock, using Moscow time in this chat. The author subsequently requested that the displayed acquisition field contain just the date and time, with no extra relative-time explanation.
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

Use `## Перевод (гипотеза)` for my coherent proposed translation. Use `## Комментарий к обращению` for a word table and separate contextual notes that must appear in the ordinary card. A separate H2 outside that comment section can be present in the full document without appearing in the card. Preserve the original and a separate copy text if the author actually provided a different copy version.

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
