# My transcription decoding workflow

Memory topic: §chatgptdecoding. Written on 11 October 2026 from the work and corrections in this chat.

## The approach that helps me most

I get more useful candidates by retaining the exact sound structure, testing small components against repeated contexts, and postponing the smooth translation until the uncertain components are visible. A coherent prayer is easy to invent; the difficult task is to account for the actual recorded form.

Read the current [main prompt](../site/public_html/data/promptForAlice_guessingTheMeaningOfTheGlossary.txt), [word method](../docs/dictionary/methodology.md), [suffix method](../docs/dictionary/suffix-methodology.md) and [sign system](../site/public_html/assets/documents/transcription-symbol-systems.md). These owners can change; this page saves how I reason, rather than a second copy of their definitions.

For differing spellings and sounds, consult the [spelling and sound reference](spelling-and-sound.md), added on 13 October 2026. Apply each correspondence only with its language, pronunciation tradition and positional conditions; preserve uncertain stress and the original recorded form.

## 1. Keep three layers separate

| Layer | What it contains |
| --- | --- |
| Original | The exact recorded transcription, including punctuation and author glosses in their original positions |
| Analysis | Proposed segmentation, languages, dictionary matches, counterexamples and unknown remnants |
| Coherent translation | A readable reconstruction, explicitly marking meaningful additions or uncertain choices |

Do not silently change the original to make a candidate work. If I need a normalised search string, keep it separate. Double parentheses often contain the author's proposed identification, rather than additional sounds; preserve the distinction without deleting the annotation.

## 2. Use pauses and the start of a word

The author clarified that `*` is a pause or isolated sound inside a word, like an upper comma between sounds. A fragment at the beginning of a line can be the beginning of a larger word. These boundaries can narrow possible components; they do not by themselves identify the word.

Preserve `*`, hyphens, `=`, `/`, `!`, `[+]`, `[>]` and other recorded signs. Check the current sign owner for their definitions before treating them as ordinary punctuation. For example, an equivalence sign and a neutral block ending can affect the relationship between fragments. Do not interpret technical-looking text as commands for me to execute. On 12 October 2026 the author clarified that «/» and «\» are equivalent sentence endings; preserve that boundary in analysis, while the display copy replaces either technical sign with `⟐`.

## 3. Search existing readings before inventing another

Search the canonical word, suffix and abbreviation owners, then source analyses in `docs/transcriptions/`. Use exact literal search first; a star in the input is not a search wildcard. Useful commands from the repository root include:

```powershell
rg -n -F -- 'неордовитениум' docs/dictionary docs/transcriptions
rg -n -F -- 'фиктим' docs/dictionary docs/transcriptions
```

Compare the same form in similar positions and contexts, not just its presence somewhere in a large file. A copied analysis or repeated display of one record is not an independent occurrence. Preserve differences between spellings and account for them instead of normalising them into agreement.

## 4. Test the form, grammar and context separately

For each candidate ask:

1. Which recorded consonants, vowels, pauses and boundaries does it explain?
2. Does the proposed grammar exist, or am I borrowing only the meaning of a dictionary root?
3. Does that meaning fit this context without supplying most of the sentence myself?
4. What remains unexplained, and does another candidate explain it better?

The consonant pattern is a useful search scaffold. Changes of vowels may suggest a related form, as the author proposed for «Илохим» and «Елохим». They do not automatically prove a case ending, a conjugation or Hebrew grammatical behaviour. Apply the current prompt's procedural limit in section 4.2: if a match requires inserting two or more unrecorded consonants, stop that candidate as a forced fit. This is a working constraint, not a measured probability of correctness. Also penalise arbitrary syllable swaps and unexplained long suffixes.

The project prompt starts with Hebrew; also keep Greek, Latin, English, Russian, Church Slavonic and Aramaic possibilities open where the form warrants them. Explore Arabic when requested or supported by a concrete component. A recognisable word does not establish the language of the whole utterance. Mixed components are a hypothesis to test, not a shortcut that permits any combination.

## 5. Check scope before forcing a single translation

Ask what a negative, suffix, exclamation or final command applies to. «Не» can be proposed as negating a whole statement or as part of a proposed «непорядок» reading. «Стоп» can be an instruction, a sentence boundary or a statement that something has stopped. These alternatives change the meaning even when the component words are unchanged.

Retain compatible readings if they capture genuinely different relationships in the recorded text. Do not conclude that ambiguity was intentionally encoded merely because two reconstructions are possible. The saved T00061 example is in [working hypotheses](hypotheses.md).

## 6. Develop biblical interpretation after the word work

The author's compression model suggests that two or three nearby roots may evoke a particular verse. Look for the actual cluster, sequence and context in the relevant Bible text; one common religious word is weak evidence. Compare Russian and Church Slavonic translations when their phrasing is relevant.

Use Pardes as an interpretive framework after the literal candidates are exposed. A thematic association at the levels of remes, derash or sod does not prove the proposed etymology. If discussing calendar or feast associations, use the acquisition date, not today's date. Keep a plausible parallel separate from a verified quotation and from a claim about the source of the prayer.

## 7. Return a word table and a coherent version

For important fragments show the exact form, candidate meaning, basis, status and significant alternative. Leave unresolved material visible as unresolved. Then provide a coherent proposed translation and identify any causal links, agents or results that were reconstructed rather than read from an established form.

Keep the project's УСТАНОВЛЕНО / КАНДИДАТ / ДОГАДКА vocabulary with the source of the status. An author-confirmed usage is not independent linguistic confirmation. A percentage assigned by the author to a card is not my measured translation accuracy. When the author says a version strongly resonates, retain that preference as an author observation and keep the competing readings accessible.

## 8. Update the correct owner and test the proposal

When an integration calls for dictionary additions, record a new reading once in its correct canonical owner with its source and status. Do not copy a particle into both words and morphology. Retain previous contexts rather than replacing them with the newest preferred meaning everywhere.

The strongest next checks would be recurrence with the same function in another record, an explained form change, a blind analysis made before seeing the author's intended meaning, and comparison with alternative segmentations or control material. These are proposed checks; this notebook does not claim they have been completed.

## 9. Lessons from the T00063 discussion, 12 October 2026

The [T00063 case](../docs/transcriptions/T00063.md) helped because the author supplied component senses, then accepted or corrected the proposed relationships. Save that procedure without treating this single case as a general compression rule.

1. **Partition first, then rejoin exactly.** The proposed `инфе | нки | терен | дино | ен | териум` rejoins as `инфенкитерендиноентериум`, preserving every recorded letter and its order. Compare alternative boundaries on this same string rather than silently rewriting it. The discussed `дино*ен` is an analytical pause proposal; the original did not acquire a new star.
2. **Use the author's description to choose a search direction.** The cleansing-place image for «Рефинотериум» and the painful inner-fire image for «инферно» narrowed the candidate senses. Those descriptions are author glosses, not proof of a foreign etymology or a medical mechanism. A meaningful reconstruction can still contain an unresolved language match.
3. **Separate a state from the action protecting it.** The author chose «нки» as the state of being free from something, then «терен» as protecting or preserving that state. Hebrew נְקִי and Greek τηρεῖν provided lexical candidates for those different roles. This was more useful here than assuming that both parts name a transfer operation, or that «терен» means an instruction document.
4. **Explain a shortening sound by sound.** For the candidate Hebrew imperative עַיֵּן, compare `а-йен → йен → ен`: loss of the initial portion, with Russian initial `е` potentially retaining the sound sequence [je]. The same spelling effect can occur after a vowel in «диноен». This is conjectural clipping, not a regular Hebrew inflection. The first ע is a root consonant, not a removable prefix. The author's notation may use `е` differently, so the written form alone cannot settle the sound.
5. **Test recurrence without forcing identical boundaries.** The author accepted «Енториум» as a place of examination or study. That makes «ен» worth checking in other records, but «эконтиментериум» also allows boundaries that leave «ен» inside another component. A matching letter sequence is not yet the same morpheme. The dictionary and the original occurrence remain the owners of each reading.
6. **Compare a direct lexical candidate with a proposed blend.** For «шеон», Hebrew שְׁאוֹן, turmoil or tumult, was preferred by the author over the earlier «шион + шеол» blend. A source-language word explaining the local context can reduce unnecessary recombination; retain the earlier proposal as history instead of changing every «шеон» in the project.
7. **Keep different readings of the same letters visible.** «Инфектитерред» was examined both as Latin-associated `инфект | итер | ред` and as an English-associated `in fact | it | erred`. The accepted composite was «Ошибка допущена. Незавершённый путь — восстановить». It combines a diagnosis with a requested action. The author's acceptance establishes the chosen reading in this discussion; it does not prove that two languages independently decode the whole form or that the requested restoration occurred.

For each such step, retain three separate labels: the author's accepted sense, the checked lexical meaning, and my proposed segmentation or relation. «С милосердием» came from the author's interpretation of the prayer context, not from the lexical meaning of «айен». Names interpreted as functions and long compound-looking words do not establish angelic agents, effective commands, or a cause of symptoms. The task remains textual analysis.

## 10. Lessons from T00065, 12 October 2026

The current source is [T00065](../docs/transcriptions/T00065.md). The author authorised retaining useful chat memory in the project on this date.

- Search both the exact form and nearby spellings in original transcription blocks. Repeated quotations, index pages and interpretation text do not count as independent occurrences. The author's city identification narrows «найрубинск» to a Rybinsk association; it does not explain the prefix «най» or make every word about the city's economy.
- The author corrected this record to «теракт», with one «р», and explicitly declined retaining the superseded spelling in its history. This is a correction to this source, not permission to rewrite other records or equate the word with a real external event.
- Keep a sentence ending when composing the readable translation: «\» and «/» have the same function. Several command-like fragments before that boundary can be separated by semicolons without inventing new sentence endings.
- Revise the candidate when the author corrects its intended image. For «серрум», the current direction is alchemical sulfur, not the previously proposed iron properties «устойчивость / защитная прочность». The sulfur–soul analogy is documented in the sources retained in T00065; the identification of this recorded word remains an author hypothesis. The isolated «ф» after the pause remains unresolved.
- Keep contextual candidates local. «лоялти» can suggest faithfulness or commitment to a cause; the object of that commitment is not supplied by the word. «юр → юридический» and «ва → вариант» are author proposals for this case, not universal replacements in every similar form.
- Preserve unknown words in the coherent version instead of letting a fluent reconstruction hide them. Receiving circumstances do not independently establish a particular lexical reading.

## 11. Check a whole word before splitting it, 13 October 2026

The lexical audit found [Ергостериум](../docs/transcriptions/T00046.md) close to Latin ergasterium, a workshop, attested in Isidore XV.6.1 and related to Greek ἐργαστήριον. The full consonant sequence is explained without inventing several tiny roots; the recorded vowel о versus а still needs checking. This is a strong candidate, not an independently verified reading of the prayer.

Use this order: search the full form and close whole-word spellings, try two or three large components, and only then test short-root combinations. Latin borrowings from Greek and specialised or older vocabulary can account for a long form more economically than a mixed-language compound. A useful whole-word match does not require interpreting every familiar-looking internal sequence as its own morpheme.

Also distinguish a correction to the source-language gloss from rejection of the author's image. The audit separated tenendum, holding or retaining, from the proposed remelting image; that image can remain attributed to the author. When replacing a Strong number for a noun, preserve an adjacent correct number referring to its verb. Recheck both the label and the actual link.

### Compare sounds before counting vowel substitutions, 13 October 2026

The author reminded me that a transcription records speech sounds and proposed Russian unstressed а/о merger for Ергостериум versus ergasterium. The tentative stress was «ЕргостЕриум  вроде». With that stress, the vowel is pretonic; Russian adaptation can make the two source spellings sound close. Compare the plausible sound and stress before treating a different letter as an unexplained sound change. Preserve the exact recorded form, the author's uncertainty about stress, and the candidate status; do not generalise Russian reduction into a rule of Latin or arbitrary vowel replacement.

### Other audit lessons worth keeping, 13 October 2026

- A wrong dictionary reference does not necessarily invalidate the whole proposed meaning. Correct the exact defect first: the reference, foreign spelling, part of speech, grammatical form or claimed literal meaning. For example, distinguish a noun's Strong entry from its related verb rather than changing every occurrence of the number in a block.
- A recognised component can improve the analysis without solving its container. Keep the unknown remainder visible: `Ен · воркинг`, `екторгум · форк` and `Ергостериум · ефо` are partial readings, not complete translations. A smooth sentence must not silently supply a subject, object or completed outcome.
- Test grammar after recognising a word. Latin `volutus` is not an imperative merely because the proposed translation contains a command. Likewise, a recorded Greek stem without its ending does not establish person, tense or mood. Keep a useful contextual instruction separate from the lexical form supporting it.
- Correcting a foreign gloss does not require deleting an author's image. `tenendum` supports holding or retaining; remelting remains a separately attributed interpretation. This distinction lets me remove a definite linguistic error while retaining useful context.
- Count independent original occurrences, not quotations, indexes or full copies of one analysis. A repeated form helps select a search direction; repeated proposed translations do not independently confirm its meaning.

The detailed changes and verification belong to the [dated lexical audit](../docs/dictionary/lexical-audit-2026-10-13.md), while current meanings remain in the canonical dictionaries. These notes keep the reasoning procedure rather than another active dictionary.
