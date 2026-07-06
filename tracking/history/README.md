# Training History — Provenance & Index

## Source

| Field | Value |
|---|---|
| Original file | `~/Downloads/Copy of תוכנית אימון שקד.xlsx` |
| Extraction date | 2026-07-05 |
| Extractor | openpyxl via Python 3; plain-text dump at `/tmp/fitness-issues/xlsx-dump.txt` |
| Sheets used | `סייקל 1- 6.8- 9.9`, `סייקל 2 - 10.9` |
| Sheets ignored | `גיליון9` (partial cycle-2 draft), `גיליון10` (empty), `גיליון11` (cycle-2 draft — used as cross-reference only) |

## Date mapping

| Period | Dates |
|---|---|
| Cycle 1 Week 1 | ~6–11 Aug 2025 |
| Cycle 1 Week 2 | ~13–18 Aug 2025 |
| Cycle 1 Week 3 | ~20–25 Aug 2025 |
| Cycle 1 Week 4 (peak) | ~27 Aug – 1 Sep 2025 |
| Cycle 1 Deload | ~3–8 Sep 2025 |
| Cycle 2 Week 1 | ~10–15 Sep 2025 |
| Cycle 2 Week 2 | ~17–22 Sep 2025 |
| Cycle 2 Week 3 | ~24–29 Sep 2025 |
| Cycle 2 Week 4 (peak) | ~1–6 Oct 2025 |
| Cycle 2 Deload | ~8–13 Oct 2025 |

Dates are approximate. The spreadsheet names both sheets by their start date
(`6.8` = 6 Aug; `10.9` = 10 Sep). Exact day-of-week assignments within each
week are unknown; days are numbered 1–6 as in the spreadsheet.

## Structure

Each week file contains:
- Prescribed exercise, sets × reps/time, load, and YouTube link
- Logged results verbatim from the "Results" block in the spreadsheet
- Inline notes for deviations (skips, load changes, gym observations)

## Normalization notes

| Original spelling | Normalized to | Reason |
|---|---|---|
| Oap | one-arm pull-up assisted (OAP) | Shaked's shorthand; negative load = pulley/band assist |
| Buldering | bouldering | Consistent spelling from C1 W1 D2 onward |
| Wrist curles | wrist curls | Typo |
| Progerssion | progression | Typo (column header) |
| Weiget | weight | Typo (column header) |
| Ecc straddle front | eccentric straddle front lever | Abbreviation |
| ADV (in results) | advanced tuck raises | Context from Day 4 prescription |
| Pin arm screws | wrist pin arm screws | Exercise from "Top Mobility Drills…" YouTube |
| Shoulder acduction / abdiction | shoulder horizontal abduction | Consistent typo across sheets |

## Gaps and known issues

1. **Cycle 1 W3–W4:** several sessions skipped (W3 Day 4 + Day 6 entirely; W4 Day 3 entirely; W3 Day 5 partial). All skips preserved verbatim as SKIPPED or 0.
2. **Cycle 2 W1 D5:** skipped — "went bouldering" noted in results.
3. **Cycle 2 W3 D5:** entire power session skipped, no note.
4. **Cycle 2 W4 + Deload:** all results blank — likely not yet filled in before the spreadsheet was shared.
5. **Day 6 AMRAP (C1 W1):** results notation "1,1,0,1-1-1-1,1,1,0,0(3-4),1,1,10(3)" is Shaked's own send/attempt shorthand for the 4×4 circuit — transcribed verbatim.
6. **Spray wall times (C1 W1 D6):** 35/35/30 s logged vs 70 s prescribed — significantly below target.
7. **Dips (C2 W1 D2):** gym (isaac) not configured for dips that day — result "None" logged.
8. **Dips (C2 W3 D2):** gym (The Block) had bad equipment; weight reduced to 15–20 kg.
9. **Wrist pin arm screws video:** source spreadsheet lists "Top Mobility Drills for Healthy Wrists, Elbows, & Shoulders! - YouTube" as the note with no direct URL.
10. **C1 W4 D5 lock-off 120° prescribed:** week 4 changed this to Chin-up iso; lock-off 120° dropped. Spreadsheet is the authority.

## Index

```
tracking/history/
  cycle-01/
    week-1.md       ~6–11 Aug 2025
    week-2.md       ~13–18 Aug 2025
    week-3.md       ~20–25 Aug 2025   (partial — 3 sessions skipped)
    week-4.md       ~27 Aug–1 Sep     (partial — Day 3 skipped)
    week-deload.md  ~3–8 Sep 2025
  cycle-02/
    week-1.md       ~10–15 Sep 2025   (Day 5 skipped)
    week-2.md       ~17–22 Sep 2025
    week-3.md       ~24–29 Sep 2025   (Day 5 skipped)
    week-4.md       ~1–6 Oct 2025     (results not logged)
    week-deload.md  ~8–13 Oct 2025    (no prescription, no results)
  README.md         this file
```
