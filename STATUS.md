# Status

Last updated: learning workspace redesign (local verification).

Honest notes: what runs, what was tested and how, and what is missing.

## Learning workspace redesign

- Responsive workspace, four existing theme IDs and five locales; searchable library, topic discovery, camp-scoped study and optional source context. Invitations and document upload remain available. Topic search is disabled by default and requires separate server-side configuration and approval.
- Session restoration waits for authentication before routing; a fresh device restores synced data only if its local docs, outbox and cursor are empty. An explicit device theme takes precedence over the account theme. Local study can use cached account information when offline or the API is unreachable. Reconnection revalidates cached sessions even with sync disabled; revocation cannot be detected while disconnected.
- Frontend `npm test`: 451 passed, including secret scan. API `npm test`: 115 passed, including discovery, source safety and extraction fixtures. Chromium workspace smoke covers three widths, all themes, keyboard focus, reduced motion, chip contrast, session reload, offline home and revoked-session reconnection. Two-device sync/theme smoke passed. Offline study smoke answered a question, reconnected and synced the outbox. Independent review also informed fixes for camp selection and source import.
- Not yet verified end-to-end: live search/provider and live external source fetching, real-world PDF/DOCX/PPTX/EML browser uploads, all activity types and admin/export actions, screen readers and non-Chromium browsers. Non-English translations still need native review. These results describe local verification.

## Public handoff and Practice

### Done

- Public repository basics: README, MIT `LICENSE`, secret-safe `.gitignore`, and a GitHub Pages workflow (`.github/workflows/pages.yml`) with `scripts/build-pages.mjs`, which writes the runtime API config and the CSP origin from the `API_BASE` repository variable.
- Practice supports the existing mixed bite and resume flow plus standalone rounds for available activities in the active Pack. Answers use the study mastery rules, save progress per answer, and save an attempt on completion.
- Weak review switches to an activity chooser backed only by weak facts. Practice result strings are under `ship.*` in all five catalogues; the non-English draft keys are marked for review.

### Tested

- `npm test`: **384 tests pass**; its secret scan is clean. `node scripts/secret-scan.mjs` also passed separately.
- `PORT=18991 python3 dev/smoke-with.py dev/smoke-practice.py`: passed against the mock API. Created a Pack, completed a flashcard round, verified saved attempt/progress, then confirmed weak review contains one question. The stored progress states were `weak` and `learning`; no browser errors were reported.
- `bash -n scripts/deploy-frontend.sh` and a fake-SWA deploy: passed runtime config, CSP origin, build stamping and deployment URL checks. No real Azure deployment was performed.

### Missing or not verified

- `package.json` still says `private: true` and `license: UNLICENSED`, despite the MIT `LICENSE`; package metadata was not changed in this work.
- No real backend or production Azure deployment was tested. Native-speaker review of the non-English catalogues is still outstanding.
- A full Study smoke is not verified here. An earlier `dev/smoke-study.py` attempt was blocked by a null review UI and a dialog interception; fixes would touch out-of-scope `review*.js` / `study.js`.

## Themes (done, committed before M2)

Four themes copied one for one from `design/visuals.html`: `dark` (Grape Night), `light` (Sunrise), `ocean` (Deep Ocean, dark) and `matcha` (Matcha Pop, light), plus `system` (follows the OS and resolves to Grape Night or Sunrise). All tokens live in `styles/app.css`, every component reads variables only, and a test fails if a hex colour appears outside the token blocks. Me has a theme picker with a colour preview tile per theme and a `system` row; the choice is saved to the device and to the account (`PATCH /me`, `theme` accepts `dark light ocean matcha system`). The logic is in `src/app/themes.js` and is covered by `test/themes.test.mjs` (allowed values, system mapping, one CSS block per theme with the full token set, preview colours match the CSS, no hard coded colours, labels exist). The mock now validates `theme` like the contract says.

## M1 Shell and account: done

### What runs

- **Shell.** `index.html` plus vanilla ES modules, hash router, bottom tab bar on phones and a 720px column on desktop. Practice and Library are active; current Practice scope and verification are recorded above.
- **Themes.** Dark and light from the visuals, plus follow the system. Tokens are in `styles/app.css`. The theme is a device preference and also synced to the account with `PATCH /me`.
- **i18n.** English, Estonian, Spanish, French and Finnish catalogues with a small ICU style formatter (plurals, numbers, dates, apostrophe quoting). App language and study language are separate settings. Language can be switched on the access screen before sign in. Non English catalogues are first AI drafts and carry a `_review` list.
- **Config.** API base URL read at runtime from `config.json` (placeholder committed), no cache.
- **API client.** The whole of `API.md` in `src/api/client.js`: access, auth, me, admin, sync, ingest, LLM. Access token in memory, refresh token in IndexedDB, automatic refresh on a 401 with rotation, generic errors surfaced as one message.
- **Auth screens.** Access (study code, same message for every failure, rate limit message), create account (after a valid code), login.
- **Me.** Language, theme, sync status and Sync now, storage usage with the persist request and a manual local wipe, AI model choice from `/llm/models` (Default, Muse, DeepSeek Flash), today's token use, account details, change password, delete account (password confirmed), sign out (optionally wiping local data), build id.
- **Admin (owner only).** Create a one time code (shown once, copy button), list codes with status, revoke unused codes, list accounts with suspend and reinstate, delete account (server refuses the last owner), usage by user and model, provider status.
- **Sync engine.** IndexedDB docs plus an outbox. Pushes the outbox, pulls `GET /sync/changes?since=cursor` on start, on focus and every 60 s, and after coming back online. Conflicts use `baseRev` and a per collection merge: `progress` and `attempts` merge per fact id, everything else is last writer wins on the server copy. Restore after a wipe or on a new device pulls `since=0`. Doc size limit of 1 MB checked locally too.
- **Storage.** `navigator.storage.estimate()`, `persist()` request, low space eviction of cached file blobs while keeping docs, and on demand re-download (`src/store/files.js`).
- **Service worker and PWA.** Registered on first load, one `BUILD_ID` names the cache, offline shell from cache, manifest and generated PNG icons.
- **Dev mock API.** `node dev/mock-api.mjs` serves the app and implements `API.md` in memory: codes, redeem, login, refresh with rotation and family revocation, me, admin, sync docs and files, usage, export, ingest for txt/md/html, LLM models and chat with a token budget. It seeds an owner and one study code and prints both.
- **Secret scan.** `scripts/secret-scan.mjs` and `.github/workflows/secret-scan.yml`.

### Tested

- Original M1 run: **41 tests passed**, secret scan clean. The current suite count is recorded above.
  - i18n: key completeness both ways, placeholder parity, `_review` present, plural categories for all five languages (French 0 and 1 as one), exact forms, locale numbers, dates, apostrophe quoting, missing values throw.
  - sync: outbox push, tombstones, pull and cursor, pagination, offline queueing, failed push keeps the queue, conflict on packs, conflict on progress merges facts, stale `baseRev`, restore from `since=0`, doc size limit, concurrent sync shares one run, merge rules.
  - API contract over loopback HTTP with the real client against the mock: health, code check and redeem, single use, duplicate email, login failure, refresh rotation and reuse revoking the family, me and patch validation, admin forbidden for members, codes shown once and never in the list, revoke, accounts, usage, providers, suspend revoking sessions, last owner protected, sync put with 409 conflict carrying serverRev and serverDoc, changes and tombstones, files and usage, export, models and chat, delete account, ingest extract and 415.
- **Browser smoke test** (`dev/smoke.py`, Python Playwright against the mock; not part of `npm test` because it needs a browser and a running server): access screen, generic error on a bad code, switch to Estonian and back, redeem a real code, create account, home, Me screen contents, light and dark themes, model switch, language screen in Spanish, member blocked from Admin, sign out, owner login and Admin with code creation, desktop width. No console errors. Service worker reaches `activated` and the shell cache is created.

### Not tested

- The real backend. Only the mock was exercised.
- Real browsers other than Chromium, and no screen reader pass yet.
- Estonian, Spanish, French and Finnish wording with a native speaker (marked as drafts).
- Low space eviction with a genuinely full device (the logic is in place and manual, not simulated).

### Known gaps and decisions for the next milestone

- The Pages build adds the CSP as a meta tag (Pages cannot send headers), so `frame-ancestors` is not enforced.
- The mock API has no PPTX, PDF, DOCX or EML extraction; it answers `415` for those so the real backend is not confused with the mock.
- The mock's LLM replies are fixed JSON shapes for `ingest_map`, `generate`, `score`, `teach`, `lens` and `translate`. They are a stand in until M2 and M3 build the real prompts.
- Practice and Library are implemented; Talk was not covered by this handoff.
- Trail home has readiness and plan views, with an empty-state CTA when no plan exists.
- Sounds and haptics are not wired yet (off by default and not part of M1).
- Redacted or deep offline conflict review UI (choose a side by hand) is not there; the automatic merge rules decide.
