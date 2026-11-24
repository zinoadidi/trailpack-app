# STATUS-WIRE-D: exports ZIP, Lens consistency, progress and data hygiene

Agent D (key prefixes `wired.` and `zip.`). Four commits on `main`, `npm test`
green after each (**379 tests pass**, secret scan clean). Files touched are
only mine plus `src/game/store.js`, `src/screens/trail.js` (one read-only line),
`src/study/hygiene.js` (new), `src/screens/progress-data.js` (new),
`src/export/bundle.js` (new), three test files and `dev/add-keys-d*.mjs`.

## Done

### 1. Download all (ZIP) on `#/exports`
- `src/export/bundle.js`: `bundleEntries(pack, {campId, date, lensTitle, lang})`
  builds the study guide, cheat sheet and Anki file with `buildExport` from
  `src/game/export.js` and returns `{fileName, entries: [{format, mime, text, name}]}`.
  `zipBundle` adds the bytes via `zipStore` from `src/export/zip.js`.
- Names are deterministic and ASCII: `<slug(title)>-all-<YYYY-MM-DD>.zip`, files
  `guide-all.md`, `cheatsheet-all.md`, `anki-all.tsv`, or `-<camp-slug>-` for one
  Camp. `bundleSlug` folds accents (`Õppimine` → `oppimine`), no path characters.
- UTF-8 throughout; the ZIP is store-only with correct CRC and an end record
  that counts the files.
- The exports screen now resolves the **real pack bundle** (topics and facts via
  `resolveActivePack`; it used to read a `meta / active-pack` key that nothing
  writes) and shows a **Download all (ZIP)** row with a toast that names the file
  count.
- Test: `test/wired-bundle.test.mjs` (6 tests) — entry list and order, camp
  naming, deterministic names, ZIP structure/CRC/sizes decoded from the bytes,
  UTF-8 round trip, empty pack.

### 2. Lens on every fact screen
- `src/game/store.js`: `setActiveLens` / `loadActiveLens` / `ACTIVE_LENS_META`.
  The choice is saved to `meta / active-lens`, mirrored on `state.activeLens`,
  and reloaded by every screen. The Lens bar saves the choice on approval, so
  the chosen Lens survives a reload and is the same one on every screen.
- `src/screens/lens-bar.js`: new `lensState()` (saved choice → first saved →
  default), `lensChip()` (read-only chip) and `lensPicker()` (segmented list of
  saved Lenses that saves the choice).
- `#/exports`: Lens chip in the header, Lens bar with the rebuild estimate, and
  the Lens title goes into the export footer and the ZIP.
- `#/progress`: Lens chip on the streak card, the picker plus the Lens bar.
- `#/trail`: read-only chip naming the active Lens plus a "Change Lens" link to
  `#/progress`.
- Template-importing `src/game/store.js` into a node test of `game-store.test.mjs`
  is unaffected (state.js only reads `navigator` defensively).

### 3. `#/progress` overhaul
- New pure module `src/screens/progress-data.js`: `packMastery`, `masterProgress`
  (mastered/total per topic, an `Other` row for facts whose topic is gone),
  `snapshotReadiness` (calls `readiness` from `src/study/trail.js`, same number
  as the Trail) and `readStudySnapshot` (pack, topics, facts, progress, plan,
  newest attempt for recency).
- Screen now shows: level with progress bar, answer streak, day and plan
  streaks, **mastery per topic** with bars, the **readiness** number with its
  bar and a Trail/recall-only caption, points breadcrumb on level, Shortcuts,
  achievements grid, Lens picker and Lens bar.
- Empty states for a new account: no pack → "finish your first bite" copy on
  mastery and readiness, no crash. Load failures show one calm panel.
- Test: `test/wired-progress.test.mjs` (5 tests).

### 4. Data hygiene (`src/study/store.js`, `src/study/pack.js` only)
- `src/study/hygiene.js` (pure): `progressDocId`, `deletionPlan` (which progress
  rows and attempt rows a fact delete touches; a shared attempt keeps its other
  answers, an attempt that only held the fact is deleted),
  `factsRemovedWithTopics`.
- `store.js`: `deleteFactDocs(ids)` removes each fact **plus** its progress row
  and its attempt rows; `pruneOrphans()` sweeps progress whose fact is gone;
  `deletePackDocs` now goes through `deleteFactDocs`, so deleting a pack no
  longer leaves progress behind.
- `pack.js`: `REVIEW_CONFIDENCE` (0.5), `hasSource` (source name, page, url,
  `sourceId` or `chunkId`), `confidenceOf`, `reviewReasons` (`no-source`,
  `low-confidence`), `needsReview`, `reviewQueue(facts, topics)` with per-reason
  counts and topic titles.
- Test: `test/wired-hygiene.test.mjs` (9 tests), including the real store code
  against an in-memory store.

### i18n
New keys, all five catalogues (`en et es fr fi`), under my prefixes only:
`lens.chip`, `lens.pickerLabel`, `lens.nowUsing`, `wired.*` (readiness, mastery,
review, changeLens — 13 keys), `zip.*` (4 keys). Non-English strings were added
to each catalogue's `_review` list as drafts.

## Tested
`npm test` after each piece: 364 → 370 → 370 → 379 passing, secret scan clean.
Only node logic was run (no browser pass this session); the screens compile
(`modules.test.mjs`) and every literal key check stays green.

## Missing / not done
- No browser smoke run of the new ZIP button, the picker or the Trail chip;
  the ZIP bytes are verified in node but not opened in a real unzip tool.
- `state.activeLens` is not part of the Lens picker sync doc beyond the local
  `meta` row: the choice is saved per device, not pushed as a synced setting.
- `reviewQueue` and `deleteFactDocs` are not wired into the review or library
  screens (those files belong to other agents); the functions are ready for them.
- `login.js`/`me.js` Lens mentions (if any) were not touched.
- The ZIP writes no manifest file; names only, as specified.
