# Trailpack API contract (v1)

Base path: `/api/v1`. JSON in, JSON out, UTF-8. Errors: `{ "error": "<code>", "message": "<plain text>" }` with the right HTTP status. Auth: `Authorization: Bearer <accessToken>` unless marked public. CORS: only origins in `CORS_ORIGINS` (comma list), credentials not used (bearer tokens, no cookies).

Error rules: failures on access, login and refresh return the same generic error for every cause (`invalid_credentials` or `invalid_code`), so nothing leaks about whether an account or code exists.

## Public
| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/health` | | `{ok, version, time}` (no config, no secrets) |
| POST | `/access/check` | `{code}` | `200 {ok:true}` or `400 invalid_code` (rate limited) |
| POST | `/access/redeem` | `{code, name, email, password, lang?}` | `201 {user, accessToken, refreshToken, expiresIn}`; consumes the code atomically; `400 invalid_code` |
| POST | `/auth/login` | `{email, password}` | `200 {user, accessToken, refreshToken, expiresIn}` or `401 invalid_credentials` |
| POST | `/auth/refresh` | `{refreshToken}` | new pair; refresh tokens rotate; reuse of an old one revokes that whole session family |
| POST | `/auth/logout` | `{refreshToken}` | `204` |
| POST | `/admin/bootstrap` | `{setupToken, name, email, password}` | creates the first `owner`; `setupToken` must equal env `OWNER_SETUP_TOKEN`; after one owner exists returns `404` |

`user` = `{id, name, email, role: "owner"|"member", lang, studyLang, theme, model, status}`. Never includes hashes.

## Account (any signed in user)
| GET | `/me` | | `{user, usage:{tokensToday, budgetToday}}` |
| PATCH | `/me` | `{name?, lang?, studyLang?, theme?, model?}` | updated `user` (`lang` and `studyLang` in `en et es fr fi`; `model` in `auto muse deepseek-flash`) |
| POST | `/me/password` | `{current, next}` | `204` |
| DELETE | `/me` | `{password}` | deletes the account and every byte of that user's synced data; `204` |

## Admin (role `owner` only, else `403`)
| POST | `/admin/codes` | `{note?, expiresInDays? (default 7), dailyTokenBudget? (default 200000)}` | `201 {id, code, note, expiresAt}`; the plaintext `code` is returned ONCE |
| GET | `/admin/codes` | | list `{id, note, status: unused|used|revoked|expired, createdAt, expiresAt, usedBy?, usedAt?}` (never plaintext) |
| DELETE | `/admin/codes/:id` | | revoke an unused code; `204` |
| GET | `/admin/accounts` | | `{id, name, email, role, status, createdAt, codeId, tokensToday, dailyTokenBudget, syncBytes}` |
| PATCH | `/admin/accounts/:id` | `{status?: active|suspended, dailyTokenBudget?}` | updated account; suspending also revokes sessions |
| DELETE | `/admin/accounts/:id` | | deletes account and data; cannot delete the last owner |
| GET | `/admin/usage?days=7` | | per user and per model counts of calls and tokens (never prompt text) |
| GET | `/admin/providers` | | `{muse:{configured,ok}, deepseekFlash:{configured,ok}}` (booleans only) |

Study code format: `TRL-XXXX-XXXX-XXXX` (Crockford base32, 60 bits shown, plus server side 128 bits of entropy is not required because codes are single use, rate limited and expire; store only `sha256(code + PEPPER)`).

## Sync (everything scoped to the signed in user; the user id is NEVER taken from the URL or body)
Collections allowed: `packs facts topics lenses plans progress attempts settings notes generated`.
Ids match `^[A-Za-z0-9_-]{1,64}$`. Doc size limit 1 MB.

| GET | `/sync/changes?since=<cursor>&limit=200` | | `{changes:[{collection,id,rev,seq,deleted,updatedAt,doc?}], cursor, more}`; `since=0` returns everything (this is the restore path when local data is wiped) |
| GET | `/sync/docs/:collection/:id` | | `{id,rev,seq,updatedAt,doc}` or `404` |
| PUT | `/sync/docs/:collection/:id` | `{doc, baseRev?}` | `200 {rev,seq,updatedAt}`; if `baseRev` is given and not equal to the stored rev: `409 {error:"conflict", serverRev, serverDoc}` |
| DELETE | `/sync/docs/:collection/:id` | | writes a tombstone (so other devices learn about it); `204` |
| PUT | `/sync/files/:id` | raw bytes; headers `x-file-name`, `content-type` | stores a source document or generated asset; `413` over the per file limit (25 MB) or the user quota |
| GET | `/sync/files` | | metadata list `{id,name,type,size,updatedAt}` |
| GET | `/sync/files/:id` | | raw bytes |
| DELETE | `/sync/files/:id` | | `204` |
| GET | `/sync/usage` | | `{docs, files, bytes, quotaBytes}` (default quota 300 MB per user) |
| GET | `/sync/export` | | one JSON download: `{exportedAt, user:{id,name}, docs:[...], files:[{id,name,type,size}]}` for a full backup |

## Ingest helper (stateless: nothing stored unless the client syncs it afterwards)
| POST | `/ingest/extract` | raw bytes; headers `x-file-name`, `content-type` | `{text, pages:[{n,text}], meta:{type,pages?,words}}` for pdf, docx, txt, md, html, eml; `415` for others; 20 MB limit |

## LLM gateway (provider keys live ONLY here, server side)
| GET | `/llm/models` | | `{default:"muse", models:[{id:"muse",label:"Muse",available:true},{id:"deepseek-flash",label:"DeepSeek Flash",available:true}]}` |
| POST | `/llm/chat` | `{task, model?: auto|muse|deepseek-flash, messages:[{role,content}], json?:boolean, maxTokens?}` | `{text, model, fallbackUsed, usage:{inputTokens,outputTokens}, budget:{used,limit}}` |

`task` in `ingest_map generate score translate teach lens other`. Rules: `auto` and the user's saved `model` default to Muse; bulk tasks (`ingest_map`, `generate`) may be sent to DeepSeek Flash when the user selects it. If the chosen provider fails or is busy: one retry, then fall back to the other provider if configured, `fallbackUsed:true`. Enforce per user daily token budget (`429 budget_exceeded` with `budget`), prompt size cap (60,000 characters), response cap (`maxTokens` up to 8,000), 60 s timeout. Log `{user, task, model, tokens, ms}` only, never message content.

## Providers (server env only)
- Muse: OpenAI compatible. `MUSE_BASE_URL=https://api.meta.ai/v1`, `MUSE_API_KEY`, `MUSE_MODEL=muse-spark-1.1`.
- DeepSeek Flash on Azure AI Foundry: `AZURE_AI_ENDPOINT` (base URL), `AZURE_AI_KEY`, `AZURE_DEEPSEEK_DEPLOYMENT=deepseek-v4.1-flash-1017`, `AZURE_AI_API_STYLE` = `v1` (path `openai/v1/chat/completions`, body `model` = deployment, header `api-key`) or `deployments` (path `openai/deployments/{deployment}/chat/completions?api-version=$AZURE_AI_API_VERSION`).
- A `mock` provider (env `LLM_MOCK=1`) returns deterministic text and is used by every test. No test may reach the network.
