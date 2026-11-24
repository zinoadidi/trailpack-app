# Status M4

Last updated: M4 (points, levels, streaks, achievements, Lens, exports, certificate, bite complete screen).

Honest notes: what runs, what was tested and how, and what is missing. M2 and M3
are built elsewhere and are **not** in this branch; see "Relations to M2 and M3".

## What runs

- **Pure game logic** in `src/game/`, no DOM and no storage in these files, every
  one takes plain objects:
  - `points.js` (M1/earlier, two bugs fixed here: Comeback pays its base points
    again, and an export award treats a missing camp and a `null` camp as equal).
  - `streaks.js`: day streak and plan streak, one free skipped day, timezone and
    given "now" passed in.
  - `levels.js`: level for lifetime points, level name keys and the next level
    progress.
  - `achievements.js`: 28 achievements, progress and unlock rules; "today"
    counters judge the newest day bucket in the profile, not the wall clock.
  - `profile.js`: the one game profile document (points, streak, bites, shortcuts,
    achievements, awarded keys), the actions `stepDone`, `biteDone`,
    `spendShortcut`, and `mergeProfiles` for the sync engine.
  - `lens.js`: Lens presets, the rule based diff fallback, diff parsing from the
    model answer, and dependency tracking that only marks `generated` items
    stale.
  - `export.js`, `export-run.js`: export doc shapes, the run state machine and
    progress, size and page maths.
  - `certificate.js`: whether a pack can be certified, and the certificate text
    and fields.
  - `bite.js`: the bite complete summary (points, variety bonus, streak).
  - `store.js`: game profile and Lens docs over the sync engine (`localChange`),
    no network code of its own.
  - `screen-helpers.js`: the small shared formatting helpers the screens use.
- **`src/game/README.md`** lists the exact input shape each module assumes, so
  M2 and M3 can hook in without reading the code.
- **Screens**: `#/progress` (level, day and plan streak, shortcuts, study style,
  28 achievements), the Lens prompt bar on progress, `#/bite` (bite complete
  summary, confetti that is skipped under reduced motion), `#/exports` (empty
  state, saved exports, certificate). The trail home links to `#/progress`,
  `#/bite` and `#/exports`; the Library tab opens `#/exports`.
- **Lens**: preset buttons and a prompt bar. The bar asks the backend
  `POST /llm/chat` with task `lens` first, falls back to `ruleBasedDiff` when
  offline or when the answer does not parse, and always shows an approval sheet
  before anything is applied.
- **i18n**: 196 new keys for every new string, in all five catalogues.
- **Themes**: all new colours are CSS variables, so all four themes and
  follow-the-system paint.
- **Reduced motion** is respected (no confetti pieces, a note says so).

## Tested

- `npm test`: **182 tests, 179 pass, 3 fail**. The three failures are in
  `test/pack.test.mjs` (`normaliseMap drops empty topics…`, `variants: broken
  shapes are dropped…`, `safeId never returns an empty or unsafe id`). They are
  M2 study code that is not in this branch; they were failing before M4 started
  and were left alone on purpose.
- New pure tests, one file per module: `test/game-points.test.mjs`,
  `game-streaks.test.mjs`, `game-achievements.test.mjs`, `game-profile.test.mjs`,
  `game-lens.test.mjs`, `game-export.test.mjs`, `game-bite.test.mjs`,
  `game-store.test.mjs`. They cover streak skips and timezones, level borders,
  every achievement rule, shortcut spending, profile merge, preset diffs, the
  rule fallback, dependency staleness, export progress and size maths,
  certificate gating, the bite summary and the store round trip.
- i18n completeness and placeholder parity tests stay green with the new keys.
- The stylesheet test still passes: no hex outside the theme token blocks.
- **Browser smoke test** (`dev/smoke-m4.py`, Python Playwright against the mock;
  not part of `npm test`): run on port 8811 against `dev/mock-api.mjs`, the
  result was `PROBLEMS: none`. It covers sign up, the three trail entry points,
  the progress screen contents, a Lens preset through the approval sheet, a Lens
  prompt through the approval sheet, spending a shortcut, the bite screen with
  reduced motion on (no confetti pieces, the note shown) and off (confetti
  drawn), the exports empty state, the Library tab opening exports, and the
  progress screen painted in all four themes. No console errors.

## Not tested

- The real backend. The Lens `lens` task is only exercised against the mock's
  fixed answer and the rule fallback. The model path has not been tried against
  the real backend or a real model.
- Exports and the certificate with real packed data. The mock seeds no packs, so
  `#/exports` only showed its empty state and the certificate gate was not
  reached end to end. `export.js` and `certificate.js` are covered by unit tests
  only.
- A real merge between two devices. `mergeProfiles` is unit tested; the two
  account smoke run only checks the second device's own screens.
- Real browsers other than Chromium, and no screen reader pass.
- Non English wording for the new keys with a native speaker (drafts, as before).

## Relations to M2 and M3

- Nothing under `src/study`, the mixer or the mastery code was touched. M2 sets
  `settings / active-pack` and `state.activeLens`, which is where exports and the
  Lens bar read the pack and the active Lens from. Until M2 lands in the same
  build, exports stay on the empty state and the Lens bar works from presets and
  prompts alone.
- Points are awarded through `profile.js` actions. M2 and M3 call `stepDone` and
  `biteDone` when a study step or a bite finishes; the bite screen renders the
  summary those calls produce.

## Known gaps and decisions

- The game profile is one document at `settings / game-profile`, last writer wins
  on the server copy, with `mergeProfiles` used on the client before a push.
- Achievement "today" counters read the newest day bucket rather than
  `Date.now()`, which makes them honest across midnight and testable.
- The mock seeds two fixed single use study codes (`TRL-2345-6789-ABCD` and
  `…-ABCE`) so the smoke run can create two accounts. Local mock only; nothing is
  deployed and nothing was pushed.
- Sounds and haptics for bites and level ups are still not wired.
