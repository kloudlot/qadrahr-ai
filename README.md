# qadrahr-ai

The AI service for QadraHR. It runs on its own server, so model calls and document parsing never compete with payroll runs or the API for CPU and memory.

It is **stateless**: no database and no Redis. [qadrahr-backend](../qadrahr-backend) is its only caller. The backend:
- authenticates people and decides whether a tenant may use AI;
- gathers the data a prompt needs and sends it here;
- stores the results and records token usage.

This service turns that data into model calls and hands back validated, structured answers.

```
browser ──► qadrahr-backend ──(service token)──► qadrahr-ai ──► OpenAI
                  │                                   │
             tenant data,                        no database,
             results, usage                      nothing stored
```

## What it does (v1: recruitment)

| Endpoint | In | Out |
| --- | --- | --- |
| `POST /v1/recruitment/screen` | multipart: `posting` (JSON) plus a `cv` file (PDF, DOCX, text) **or** `cvText` | `result` (facts extracted from the CV; a 0–100 score; interview/review/reject; summary; strengths, gaps and risk flags), `document` (format, length, whether it was truncated), `usage` |
| `POST /v1/recruitment/match` | JSON `role` + `candidate` profile | `result` (match score, fit, hire decision, reasoning), `usage` |
| `GET /health` | — | `{ status, model, inFlight, capacity }`. No token needed. |

- **`usage` on every answer:** `{ model, promptTokens, completionTokens, totalTokens }`. The backend logs it per tenant and feature.
- **`posting` fields:** `title` (required), `description`, `requirements`, `location`, `workMode`, `department`, `designation`.

### Status codes (the backend's retry policy reads these)

| Status | Meaning | Retry? |
| --- | --- | --- |
| 400 | The request doesn't match the contract | No |
| 401 | Wrong or missing service token, or no `x-tenant-id` | No |
| 413 / 415 | CV too large, or not PDF, DOCX or text | No |
| 422 `no_readable_text` | No readable text, e.g. a scanned image | No |
| 502 `llm_unavailable` / `llm_invalid_output` | OpenAI failed, or its answer didn't match the schema | Yes |
| 503 `llm_busy` + `Retry-After` | At `AI_MAX_CONCURRENCY` | Yes, after the delay |
| 504 `llm_timeout` | The model didn't answer in time | Yes |

## Security model

- **Service token:** every route except `/health` needs `Authorization: Bearer $AI_SERVICE_TOKEN`, compared in constant time, and an `x-tenant-id` header. Tenant ids are only used in logs; this service can't read any tenant's data.
- **Network:** don't expose the service to the internet. Put it on a private network with the backend. It sends no CORS headers, because browsers never call it.
- **Logs:** they record the method, path, status, tenant, request id, token counts and timings. They never record a request body, a CV or a model answer.
- **Untrusted CV text:** it goes into the prompt between fences, and the model is told nothing inside them is an instruction. A CV can't close its own fence.
- **Fair screening:** the rules forbid age, gender, marital status, ethnicity, religion, disability and other protected traits in the score and every field of the answer. The interview/review/reject label is derived from the score by fixed rules, not chosen by the model.
- **File checks:** the format is detected from the file's bytes, not its name. Size and text length are capped, which also caps the tokens.

## Running it

```bash
cp .env.example .env    # set AI_SERVICE_TOKEN and OPENAI_API_KEY
npm install
npm run start:dev       # http://localhost:4100
```

`LLM_PROVIDER=fake` runs without an OpenAI key. It answers deterministically, scoring by how many of the posting's requirement words appear in the CV. This is useful for running the backend locally.

On the backend side, set `AI_SERVICE_URL=http://localhost:4100` and the same `AI_SERVICE_TOKEN`.

```bash
curl -X POST localhost:4100/v1/recruitment/screen \
  -H "Authorization: Bearer $AI_SERVICE_TOKEN" -H "x-tenant-id: acme" \
  -F 'posting={"title":"Payroll Accountant","requirements":"PAYE, pension, Excel"}' \
  -F 'cv=@./cv.pdf'
```

Docker: `docker build -t qadrahr-ai . && docker run --env-file .env -p 4100:4100 qadrahr-ai`

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `AI_SERVICE_TOKEN` | — | Required, at least 32 characters. The same value as the backend's. |
| `LLM_PROVIDER` | `openai` | `fake` for tests or keyless local runs. |
| `OPENAI_API_KEY` | — | Required when the provider is `openai`. |
| `OPENAI_MODEL` | `gpt-4.1-mini` | |
| `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` | `60000`, `2` | Per model call. |
| `AI_MAX_CONCURRENCY` | `8` | Model calls in flight. Size it to your OpenAI rate limit. |
| `MAX_CV_BYTES`, `MAX_CV_CHARS` | 10 MB, 30,000 | |

## Tests

```bash
npm test          # unit: extraction (real PDF/DOCX), prompts, schema, capacity
npm run test:e2e  # the HTTP contract, with the fake model
```

The test scripts set `NODE_OPTIONS=--experimental-vm-modules`, because pdf.js loads its worker with a dynamic import that Jest's sandbox otherwise refuses.

## Adding a feature

1. A zod schema for the answer. Every field is required, with explicit `null` for "absent" (OpenAI strict mode needs this).
2. A prompt builder. Fence anything that came from a person.
3. A service method that calls `LlmService.structured({ name, schema, messages })` and returns `{ result, usage }`.
4. A controller route that validates its input with `parseOr400`.
5. A fake responder under the same `name` in `src/llm/fake.responders.ts`, and e2e tests.

## Where it came from

The recruitment features and prompts are adapted from ploy-api's `langchains` module (`AiMatchService`, `FileExtractionService`). Its other AI features — policy Q&A, payroll audit and forecast, reporting, exit themes — are candidates for later versions, and follow the same pattern.

Deliberately not carried over from ploy-api:
- models built ad hoc on the environment key;
- `tenantId` taken from request bodies;
- in-memory state;
- logging of model output;
- parsing JSON with a regex;
- direct access to tenant databases.
