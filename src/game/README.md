# `src/game`: gamification, Lens, exports and the certificate

Milestone M4. Everything in this folder is a **pure function over plain
objects**: no DOM, no network, no timers, no globals. The screens in
`src/screens` only render what these modules return, and every module is
covered by a test in `test/game-*.test.mjs` that runs under `node --test`.

The input shapes below are the contract. If a screen or a sync doc disagrees
with this file, this file is right and the caller is wrong.

- [Points, levels and streaks](#points-levels-and-streaks)
- [Achievements](#achievements)
- [The game profile](#the-game-profile)
- [Bite complete screen](#bite-complete-screen)
- [Lens](#lens)
- [Exports](#exports)
- [Certificate](#certificate)
- [Wiring the study screens](#wiring-the-study-screens)
- [Screens that use this](#screens-that-use-this)

## Points, levels and streaks

`points.js`, `levels.js`, `streaks.js`, `shortcuts.js`. These were written before
M4 and are unchanged apart from two small fixes (see `STATUS-M4.md`).

| Function | Input | Returns |
| --- | --- | --- |
| `basePoints(action)` | `'quiz-correct'` or `{type, difficulty}` | number |
| `actionPoints(action, mods)` | `mods = {hint?: boolean, lensDifficulty?: 'easy'\|'medium'\|'hard', comeback?: boolean}` | number |
| `bitePoints({stepPoints, activityTypes})` | number, `string[]` | number |
| `exportAward({camp, day}, log)` | `log` is `[{camp, day}]` | 0 or 30 |
| `levelFor(points, {kind, factCount})` | `kind` in `interview, exam, cert, other` | `{level, name, levelStart, levelEnd, toNext, progress}` |
| `answerStep({current, best, misses}, correct)` | | `{current, best, misses, multiplier}` |
| `touchDay({current, best, lastDay}, 'YYYY-MM-DD')` | | same shape + `changed` |
| `streakToday(streak, today)` | | `{current, best, lastDay, alive}` |
| `canSpend(wallet, {campId, kind, isCheckpoint})` | `wallet = {balance, earnedFor, used, skipped}` | `{ok, reason}` |
| `spend(wallet, {campId, kind, itemId, day})` | | `{wallet, spent, reason}` |
| `earnForStreak(wallet, dayStreak)` | | `{wallet, gained}` |

Points, thresholds and streak rules come from the private design and brand notes (kept outside this repository)
sections 4.1 to 4.5. Day keys are **local** days (`YYYY-MM-DD`), never UTC.

## Achievements

`achievements.js` holds the full design 4.4 table (28 entries) in design order.
Each entry is `{id, group, test(stats)}`.

`stats` is a flat object. Missing keys count as zero, a throwing getter never
escapes:

```js
{
  points, stepsTotal, stepsDone, checkpointsPassed, masteredCount,
  bestAnswerStreak, dayStreak, dayStreakBest, noHintCompletions, comebacks,
  comeback, camp1Done, halfway, summit, backAgain, returnGapDays,
  lensesUsedOnOneTopic, distinctLenses, bestTeachCoverage, cleanSheet,
  nightBefore, activityTypesToday, bitesToday, fullMastery,
  studyLanguages, bossFullHealth
}
```

`checkAll(stats, {earned, at})` returns `{earned, unlocked}`; `earned` keeps the
first unlock date and never pays twice. Title and help text are the i18n keys
`game.achievement.<id>` and `game.achievement.<id>.help`.

## The game profile

`profile.js` keeps one plain object per user. It is stored as doc
`settings / game-profile` and synced like any other doc.

```js
{
  v: 1,
  points: 0,
  levelBest: 1,
  dayStreak: {current, best, lastDay},      // YYYY-MM-DD
  planStreak: {current, best, lastDay},
  wallet: {balance, earnedFor, used: {campId: count}, skipped: [item]},
  achievements: {'first-step': {at: 'ISO date'}},
  counts: {stepsDone, noHintCompletions, comebacks, checkpointsPassed,
           bitesDone, masteredCount, teaches},
  days: {'YYYY-MM-DD': {bites, steps, types: [], minutes}},
  exports: [{camp, day, format}],
  lensesUsed: ['topicId:lensId'],
  studyLangs: ['en', 'es'],
  activityTypes: [],
  flags: {camp1Done, halfway, summit, cleanSheet, nightBefore,
          bossFullHealth, fullMastery, backAgain},
  bestAnswerStreak, bestTeachCoverage,
  updatedAt: 'ISO date'
}
```

Actions return `{profile, unlocked}` (or `{profile, spent, reason}`) and never
mutate their argument:

| Call | Effect |
| --- | --- |
| `stepDone(profile, {points, type, noHint, comeback, minutes, goalMet, answerStreak, when})` | points, day streak, plan streak (only when `goalMet`), counters, Back Again after a 3+ day gap |
| `biteDone(profile, {points, activityTypes, when})` | points, bites, activity types, Shortcut for a new 3 day milestone |
| `spendShortcut(profile, {campId, kind, itemId, day, isCheckpoint})` | wallet only, Checkpoints refused |
| `lensUsed(profile, {topicId, lensId})` | Lens Switcher after 3 Lenses on one topic |
| `teachScored(profile, coverage)` | Teach It at 0.8 coverage or more |
| `studyLanguage(profile, lang)` | Polyglot at 2 languages |
| `noteExport(profile, {camp, day, format}, gained)` | logs the export |
| `mergeProfiles(a, b, prefer)` | two devices, never double pays |

Achievements are checked inside every action, right after the action, so a
badge cannot appear a screen late (design 4.4).

`store.js` is the only file here that touches IndexedDB. It loads and saves the
profile and the Lenses, and asks the sync engine's `localChange` to queue the
write. It never runs in the tests except through the in-memory store.

## Bite complete screen

`bite.js`, `biteComplete(bite)` with:

```js
{
  pointsBefore,          // profile.points before the bite
  stepPoints,            // points already awarded during the bite
  activityTypes: [],     // what the bite actually used
  kind, factCount,       // for the level ladder
  dayStreak, planStreak, bestAnswerStreak, biteCountToday,
  newAchievements: [],   // ids returned by profile actions
  reducedMotion: false,  // true when the device asks for less motion
  minutes
}
```

Returns `{gained, bonus, variety, pointsAfter, level, levelUp, achievements,
streaks, confetti, plan, ...}`. `plan` is a deterministic list of confetti
pieces (colour token name, angle, delay, drift) or `[]` when reduced motion is
on. `celebrationLine(summary)` picks the one line to show and the i18n key for it.

## Lens

`lens.js` follows design 3.5 and 6.3.

```js
// A Lens, also the doc saved in collection `lenses` with id `lens.id`
{
  id: 'default', title: 'Default',
  audience: '', tone: '',
  formats: {flash: 0.4, quiz: 0.4, oral: 0.1, task: 0.1}, // sums to 1
  difficulty: 'medium',                                   // easy | medium | hard
  length: {learn_card_words: 80, flash_back_words: 30},
  emphasis: [], language: null, extra: ''
}
```

| Call | Input | Returns |
| --- | --- | --- |
| `parseLensDiff(input)` | `{fields, summary}` or JSON text or `{text}` | `{fields, summary, raw}` |
| `applyDiff(lens, diff)` | | `{lens, changed, rows}` |
| `ruleBasedDiff(prompt)` | plain words | same shape, offline |
| `presetLens(name)` | one of `LENS_PRESETS` | a Lens |
| `staleItems(items, changed)` | `items = [{id, kind, lens_fields?}]` | `{stale, untouched}` |
| `regenerationPlan(items, changed, {msPerItem})` | | counts and an estimate |

Generated items carry `{id, kind, lens_fields: []}`. The default dependency per
kind is in `DEPENDENCIES`. Facts and progress are never in scope:
`isProtectedItem()` marks `facts`, `progress` and `attempts`.

The prompt bar asks the backend first (`POST /llm/chat`, `task: 'lens'`, `json:
true`), shows the rows for approval, and falls back to `ruleBasedDiff` when the
model is unavailable. Nothing changes until the user approves.

## Exports

`export.js` builds strings from a Pack shaped object:

```js
{
  id, title, goal,
  topics: [{id, title}],
  facts: [{id, topicId, text, importance: 1..3,
           source: {name, page?},
           variants: [{type, front?, back?, question?, answer?}],
           lastAttemptWrong?}]
}
```

| Format | Builder | Notes |
| --- | --- | --- |
| `guide` | `studyGuide(pack, {campId, date, lensTitle, lang})` | Markdown, contents, sources, fact ids |
| `cheatsheet` | `cheatSheet(pack, {limit})` | top facts only, one line each |
| `anki` | `ankiFile(pack)` | TSV, front, back, tags, no header |
| `print` | `printDocument(pack)` | complete HTML with a print stylesheet, no script |

`prepareExport(format, pack, {campId, date, log})` adds the file name, the mime
type and the points (30, once per Camp per day). Camps are grouped by
`facts[].topicId`; facts without a known topic land in a trailing `Other`.

## Certificate

`certificate.js`:

```js
// input
{packTitle, learnerName, startedAt, finishedAt, points, lensCount, campCount}
// certificateData() output
{v, packTitle, learnerName, startedAt, finishedAt, days, points, lensCount, campCount, kind}
```

`certificateLines(data)` is the layout as plain text rows, `drawCertificate(ctx,
data, palette)` paints it on a 2D context. `palette` maps `page, surface, text,
muted, spark, volt, summit, orchid` to real colour strings that the screen reads
from the CSS variables, so the certificate follows the theme. `canIssueCertificate({camps:
[{state}], mockPassed})` decides when the button appears.

## Wiring the study screens

`wire.js` (pure) and `wire-run.js` (the thin store + toast + sound runner)
connect an answered step to the profile:

| Call | What it does |
| --- | --- |
| `stepInput(row, {goalMet, when, streak})` | the `stepDone` input from one answer row |
| `biteInput({stepPoints, activityTypes, when})` | the `biteDone` input |
| `stepToasts({points, levelledTo, unlocked, streak})` | `{key, values, raw?}` rows, points, streak, level, badges |
| `newLevels(before, after, options)` | levels crossed between two totals |
| `sfxFor(moment, {correct, skipped})` | the sound name for `answer`, `flip`, `step`, `bite`, `level`, `badge`, `failed`, or null |
| `walkGoalMet(plan, todayMinutes, nextMinutes)` | the Daily Walk goal, judged on the bite that crosses it |
| `recordStep({row, plan, streak})` | pay one step once (marked `step:factId` in `profile.wire.steps`), toast, sound |
| `recordBite({session, plan})` | pay the unpaid steps of a finished bite once per bite id |
| `recordFinish({points, activityTypes, session, plan})` | pay the finish bonus (+20 and variety) once per bite id |

`mergeProfiles` unions the `wire` marks from two devices, so a merged profile
still never pays a step twice. Sound (`sfx.js`) is off until the user turns it
on in Me, and every call returns quietly when it is off or when there is no
audio context (tests).

## Screens that use this

| Screen | Uses |
| --- | --- |
| `src/screens/progress.js` (`#/progress`) | profile, levels, streaks, Shortcuts, achievements |
| `src/screens/bite.js` (`#/bite`) | `biteComplete`, profile actions, confetti |
| `src/screens/exports.js` (`#/exports`) | `prepareExport`, certificate, print |
| Lens bar (on the exports and progress screens) | `parseLensDiff`, `applyDiff`, `regenerationPlan` |

All text comes from the catalogues, all colour comes from `styles/app.css`
tokens, and every animation checks `prefers-reduced-motion`.
