# qadrahr-ai

The AI service for QadraHR. It runs on its own server, so model calls, document parsing and face analysis never compete with payroll runs or the API for CPU and memory.

It is **stateless**: no database and no Redis. [qadrahr-backend](../qadrahr-backend) is its only caller. The backend:
- authenticates people and decides whether a tenant may use AI;
- gathers the data a prompt needs and sends it here;
- stores the results and records token usage.

This service turns that data into model calls and hands back validated, structured answers.

It also holds the **face engine** for clock-in face checks: two small models that run here on the CPU, with no third-party service involved. See [Face engine](#face-engine).

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
| `POST /v1/face/analyse` | multipart: one or more image files named `frames` | `model`, and per frame: `faceCount` and, for the largest face, `box`, `landmarks`, `yaw`, `eyeSpan`, `sharpness`, `brightness`, `embedding` |
| `GET /health` | — | `{ status, model, inFlight, capacity, face }`. No token needed. |

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
| 400 `unreadable_frame` | A face frame is not an image this service can read | No |
| 413 | A face frame is over `FACE_MAX_FRAME_BYTES` | No |
| 503 `face_busy` + `Retry-After` | At `FACE_MAX_CONCURRENCY` | Yes, after the delay |
| 503 `face_disabled` | `FACE_PROVIDER=off` on this deployment | Not until it is enabled |

## Face engine

`POST /v1/face/analyse` measures the face in each frame it is sent. It does not recognise anyone: it stores no templates and compares nothing. The backend holds each employee's template (encrypted, in the tenant's own database), compares embeddings, and applies the rules.

| Job | Model | File | Licence |
| --- | --- | --- | --- |
| Find the face and five landmarks | YuNet | `face_detection_yunet_2023mar.onnx` (0.2 MB) | MIT |
| Turn the aligned face into a 128-number embedding | SFace | `face_recognition_sface_2021dec.onnx` (37 MB) | Apache-2.0 |

Both are from the [OpenCV Model Zoo](https://github.com/opencv/opencv_zoo) and run on [ONNX Runtime](https://onnxruntime.ai) (`onnxruntime-node`), with [sharp](https://sharp.pixelplumbing.com) decoding the images. The pre- and post-processing in `src/face/geometry.ts` follows OpenCV's `FaceDetectorYN` and `FaceRecognizerSF`.

What comes back for the largest face in a frame:

| Field | Meaning |
| --- | --- |
| `embedding` | 128 numbers, unit length. Two embeddings are compared with a dot product (cosine similarity). |
| `yaw` | Where the nose sits between the eyes, as a signed fraction of the eye span. 0 is frontal; **positive is the nose towards the image's right**, which in an unmirrored camera frame is the person turning to their left. Not degrees. |
| `eyeSpan` | Distance between the eyes as a fraction of the image width. A size check that barely moves as the head turns. |
| `sharpness`, `brightness` | Laplacian variance and mean luma (0–255) of the aligned 112×112 crop, so they compare across photo sizes. |
| `faceCount` | Every face found, so a caller can refuse a frame with a second person in it. |

**Set up**

```bash
npm run face:models     # fetches both files into ./models, checked against pinned SHA-256
FACE_PROVIDER=onnx npm run start:dev
```

- The models are not in git. The Docker build fetches them, so an image always carries exactly the pinned files.
- **ONNX Runtime has builds for Linux and Apple silicon only.** On an Intel Mac, run the service in Docker, or set `FACE_PROVIDER=fake`.
- `FACE_PROVIDER=fake` needs no models. It reads frames built with `fakeFrame()` (`src/face/fake.engine.ts`) as instructions (who is in the frame, how the head is turned), and treats any other bytes as one frontal face whose identity is the hash of the file.
- `FACE_PROVIDER=off` is the default: a deployment that only screens CVs needs no models.

**Checking the real models**

```bash
FACE_FIXTURES=/path/to/people npm test -- onnx.engine   # <dir>/<person>/*.jpg
```

Photographs of people are not committed here, so that test is skipped unless you point it at a set you are entitled to use.

**Measured accuracy**

On the public LFW benchmark (6,000 pairs, 7,701 photographs), in the `node:20-slim` image this service ships in:

| Threshold (cosine) | Same person turned away | Stranger let through |
| --- | --- | --- |
| 0.300 | 0.70% | 0.87% |
| 0.363 (OpenCV's default) | 1.47% | 0.10% |
| 0.400 | 2.37% | 0.03% |
| 0.450 | 4.63% | none of 3,000 |

- Overall accuracy at 0.363 was 99.22% (99.38% at the best threshold, 0.31), in line with the 99.40% the Model Zoo publishes. A face was found in all 7,701 photographs.
- LFW is press photographs taken years apart, which is harder than a clock-in against a recent enrolment, and it does not represent every user base. **Set thresholds from photographs like the real ones:**

```bash
npm run build
node scripts/face-benchmark.mjs /path/to/people   # <dir>/<person>/*.jpg
```

- Speed: about 75 ms a photograph on two threads (decode 20, detect 15, embed 40), so a four-frame clock-in is roughly a third of a second.

## Security model

- **Service token:** every route except `/health` needs `Authorization: Bearer $AI_SERVICE_TOKEN`, compared in constant time, and an `x-tenant-id` header. Tenant ids are only used in logs; this service can't read any tenant's data.
- **Network:** don't expose the service to the internet. Put it on a private network with the backend. It sends no CORS headers, because browsers never call it.
- **Logs:** they record the method, path, status, tenant, request id, token counts, frame counts and timings. They never record a request body, a CV, a model answer, a face frame, a landmark or an embedding.
- **Faces:** frames are held in memory for the length of the request and never written anywhere. An embedding is biometric data; it leaves this service only in the response to the backend.
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
| `FACE_PROVIDER` | `off` | `onnx` for the real models, `fake` for tests and local wiring. |
| `FACE_MODEL_DIR` | `./models` | Where the two `.onnx` files are. |
| `FACE_THREADS`, `FACE_MAX_CONCURRENCY` | `2`, `2` | CPU threads per inference, and requests at once. Their product is the cores spent on faces. |
| `FACE_MAX_FRAMES`, `FACE_MAX_FRAME_BYTES` | `6`, 3 MB | Per request. |

## Tests

```bash
npm test          # unit: extraction (real PDF/DOCX), prompts, schema, capacity, face geometry
npm run test:e2e  # the HTTP contract, with the fake model and the fake face engine
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
