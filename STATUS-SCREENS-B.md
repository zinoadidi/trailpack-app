# STATUS — screens B (M5)

Worktree `trailpack-app-b`, branch `screens-b`. This file is agent B's honest
account of the study screens that are not the runner (those are agent A's).

## What runs

**Activities — `src/screens/activities/`** (contract: `render(container, step,
ctx)` returning `{destroy()}`; calls `ctx.onAnswer` once, text through `ctx.t`):

| type | what it does |
| --- | --- |
| `match` | tap a term then its meaning; every tile is a button; answers when all pairs are matched (`correct` only if no mismatch) |
| `order` | cards moved with Up/Down buttons and ArrowUp/ArrowDown/Home/End on the card; Check scores positions |
| `spot-mistake` | radio group of claims, one wrong; explains with `why` |
| `blitz` | 60 s timer, each pick answers; the clock running out answers as a miss so a bite cannot stall |
| `teach-back` | textarea, offline coverage against the points; "Check with the model" calls `ctx.api.chat({task:'teach'})` when the api is passed, degrades to offline with a status line |
| `sweep` | multiple choice, fill the blank, true or false or a flashcard reveal for a mastered fact |
| `listen` | Web Speech synthesis with a local-voice preference; transcript always shown; a notice when synthesis is missing |
| `voice` | Web Speech recognition when present, editable transcript either way, live coverage, Good/Again rating |

`activities/index.js` exports `renderActivity(type, container, step, ctx)` and
`BUILT_TYPES`; it returns `null` for types this folder does not own (flash,
quiz, true-false, swipe, cloze, scenario) so agent A's runner can render those.

**Trail home — `src/screens/trail.js`** (replaces the empty state for a pack):
camps drawn as an ordered path with summited/current/next/locked states and the
70 % gate per camp, the open camp, the Daily Walk card (minutes, steps, due
facts, start bite, study camp, practice), a readiness ring with its parts, the
mastery line, deadline mode with countdown, sprint notice, the re-plan sentence
and a date field that saves the deadline. The empty state distinguishes no pack,
an empty pack and a pack without camps. Logic lives in `trail-home-logic.js`,
`trail-camp-card.js`, `trail-deadline.js`, `trail-empty.js`,
`trail-home-widgets.js` (all pure except the two widget builders).

**Mixer settings — `src/screens/mixer.js`** (route `#/mixer`, linked from Me and
from the trail): auto or manual toggle, the activity × learning-state matrix as
44 px toggle buttons, presets, pins and bans, and a per camp override that can be
edited and removed. Saves to the `settings`/`mixer` doc through
`progress-store.js`. Logic in `mixer-logic.js`, the table in `mixer-matrix.js`.

**Practice — `src/screens/practice.js`** (route `#/practice`): drill one built
activity over the active pack, with a right/wrong/best-run line. Helpers in
`practice-deck.js`, `practice-result.js`, `practice-run.js`.

**Bridge — `src/screens/activity-bridge.js`**: the organiser step
(`{factId, type, variantId, state, shape}`) plus the fact and variant become the
step an activity reads; the activity's answer becomes the session answer shape;
`activityCtx(t, onAnswer, api)` builds the ctx.

## What is tested

`npm test` is green (352 tests). B's own test files:

- `test/activities.test.mjs` — shuffle, move, reorder keys, seeds, order score,
  spot-mistake index, blitz clock, sweep format and progress, speech and
  recognition detection, voice picking, coverage bands, teach feedback, the
  registry contents.
- `test/practice.test.mjs`, `test/practice-run.test.mjs`,
  `test/practice-result.test.mjs` — deck cleaning and pairing, variant lookup,
  answer shape, round summary.
- `test/trail-home.test.mjs`, `test/trail-camp-card.test.mjs`,
  `test/trail-deadline.test.mjs`, `test/trail-empty.test.mjs`,
  `test/trail-home-widgets.test.mjs` — the path, the study camp, the walk card,
  readiness, deadline and sprint, the date parser, empty states, the ring.
- `test/mixer-settings-screen.test.mjs` — the matrix agrees with
  `openCells()` (the screen and the bite cannot disagree about what is on),
  presets, summary, camps.
- `test/activity-bridge.test.mjs`, `test/listen-plan.test.mjs`,
  `test/answer-box.test.mjs` — the bridge, the speech plan, the coverage box.
- `test/screens-keys.test.mjs` — every literal `act2.`/`trailhome.`/`mixer.`
  key in the code exists in `en.json`, and the five catalogues carry the same B
  keys.

## What is missing or assumed

- **No DOM tests.** There is no jsdom in the repo; the screens are not unit
  tested, only the pure functions behind them (and the two widgets against a
  hand written DOM stub). Nobody has walked the screens in a browser in this
  worktree.
- **Agent A's runner.** `#/bite` is agent A's. `activity-bridge.js` gives them
  `activityStep`/`activityCtx`/`activityAnswer`; they must call
  `renderActivity(step.type, container, activityStep(step, variantFor(step,
  facts)), activityCtx(t, onAnswer, state.api))`. `variantFor` is exported by
  `src/study/session.js`.
- **LLM teaching score** only works when `ctx.api` is passed; the offline
  coverage check always works.
- **`main.js`** got exactly two one line route additions (`#/mixer`,
  `#/practice`); the practice tab is still the "soon" placeholder.
- **Mixer pin row** hard-codes the activity list; a new activity type needs one
  word there.
- **Translations** for et/es/fr/fi are B's own; no native speaker reviewed them.
- **Daily minutes** on the trail are estimated from stored attempt rows (0.45
  minutes per step), not from a separate timer.
- **Deadline mode** marks sprint at 14 days or less; the re-plan sentence uses
  `trail.behind` from the existing catalogue when the plan is behind.
