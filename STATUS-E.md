# STATUS-E: Sign-up to study bite flow

## Done

- Fixed the smoke runner to select an available mock port and fail if the mock does not start.
- Fixed document-ingest review issues: phantom source placeholders, null review nodes, question-generation feedback, and smoke-step button matching.
- Wired needs-review counts into Library Packs, the review header, and topic rows. Dropped-topic facts are cleaned up with `deleteFactDocs`; edits refresh the review-header count. Draft Packs use their saved draft facts/topics for the Library badge.
- Extended the browser smoke to check the draft badge, dropped-topic cleanup and header refresh, question-generation toast, and the study bite flow.

## Tested

- `npm test`: 384 passed, 0 failed; secret scan clean.
- `python3 dev/smoke-with.py dev/smoke-study.py`: passed; nine activities answered, no console errors.
- `python3 dev/smoke-with.py dev/smoke.py`: passed; signup flow completed, no console errors.
- Read-only review of the latest changes: no actionable findings.

## Missing / not verified

- The flow was tested against the local mock API, not the real backend.
- No non-Chromium browser or screen-reader pass was run.
- Non-English translation wording remains subject to native-speaker review.

## Commits

- `9077ee3` — allocate isolated mock port for browser smoke
- `93169a6` — fix ingest review and question feedback
- `f94ed8e` — surface review queue and clean dropped facts
- `b8eb2ac` — verify draft review badges after edits
