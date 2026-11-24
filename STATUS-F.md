# Final status (F)

Updated: 2026-11-24

## Done

- Public repo handoff files and Azure SWA deploy script are in place.
- Practice supports standalone activity rounds, the mixed bite/resume flow, per-answer progress saves, completion attempts, and weak-only review.
- Practice messages are localized under `ship.*` in `en`, `et`, `es`, `fr`, and `fi`.

## Tested

- `npm test`: 384 passed; secret scan clean.
- `PORT=18991 python3 dev/smoke-with.py dev/smoke-practice.py`: passed against the mock API; confirmed a completed round saves progress and an attempt, and weak review shows one question.
- Fake-SWA deploy validation and `bash -n scripts/deploy-frontend.sh`: passed config injection, CSP origin, build stamp, URL output, and shell syntax checks. No production deploy was run.

## Missing or unverified

- `package.json` still declares `private: true` and `license: UNLICENSED`; the MIT `LICENSE` exists, but package metadata was not changed.
- Real backend and production Azure deployment are untested; non-English draft translations still need native-speaker review.
- Study end-to-end smoke remains unverified: an earlier attempt hit a null review UI and dialog interception. Fixes would require out-of-scope `review*.js` / `study.js`.
