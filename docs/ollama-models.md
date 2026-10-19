# Ollama decision model assessment

Checked on 2026-10-19 against Ollama's [decision catalog](https://ollama.com/search?c=decision), [System One guide](https://docs.ollama.com/capabilities/decision), and the model pages linked below. This catalog is a dated selection, not automatic discovery of future releases. Arbitrary tags remain selectable with `--models` or `OLLAMA_EVAL_MODELS`.

## Dataset fit

The frozen input is `synthetic-aws-v3`: 139 incidents across SQS, RDS MySQL, API Gateway, DynamoDB, RDS PostgreSQL, and Lambda. Descriptions range from 566 to 1,270 characters, before the incident wrapper and shared questions. Every model receives the same full evidence, including decision-time operations observations. The four-category `choice` question and independent attention `noul` question fit the documented interfaces of every family below; image support isn't needed. Labels, notes, profiles, and scenario families stay out of the request.

| Category | Attention required | Attention not required |
| --- | ---: | ---: |
| throttling | 19 | 17 |
| authentication | 12 | 19 |
| dependency_failure | 19 | 15 |
| other | 16 | 22 |

All 30 mechanism families have both attention outcomes. There are 106 development cases and 33 held-out cases, grouped by family. Independent human annotation and production validation remain pending. Selecting a model using these results exposes the held-out scores; they don't become a fresh blind test. No evidence, labels, questions, or threshold were changed for this task.

## Included checkpoints

One representative tag is included per distinct checkpoint or size. Explicit tags can evaluate different quantizations as well. Download size is separate from runtime memory; large models can offload to CPU and run much more slowly.

| Family and reference | Suite tags | Compatibility and limits |
| --- | --- | --- |
| [Liquid AI d1](https://ollama.com/library/d1) | `d1` | Existing 3B GGUF baseline; LFM Open License v1.0. `latest`, `3b`, and `3b-q8_0` currently identify the same weights. |
| [Together AI Tev1](https://ollama.com/library/tev1) | `tev1:0.8b`, `tev1:4b` | Distinct 0.8B and 4B checkpoints; Ollama 0.35+. Text decisions through the same endpoint. |
| [Bespoke Nimble](https://ollama.com/library/nimble) | `nimble` | 9B; GGUF and MLX packages; Apache 2.0. |
| [Bespoke Nimble v3](https://ollama.com/library/nimble-v3) | `nimble-v3` | Distinct 9B checkpoint; GGUF and MLX; Ollama 0.40.4+; CC BY-NC 4.0, noncommercial use only. |
| [Convai Laya](https://ollama.com/library/laya/tags) | `laya`, `laya:322m-multilingual-bf16`, `laya:421m-typed-decisions-bf16` | English 421M, multilingual 322M, and typed-decisions 421M checkpoints. Explicit BF16 tags have GGUF packages; Ollama 0.40+. The English package defaults to a 512-token runtime context and rejected longer requests in this benchmark; architecture metadata lists 8,192. The other two checkpoints completed all cases. The family README also describes short training/input budgets. |
| [Cloudflare Clef Flash](https://ollama.com/library/clef-flash) | `clef-flash` | 9B; text/image; Ollama 0.35.1+; Apache 2.0. |
| [Cloudflare Clef](https://ollama.com/library/clef) | `clef` | 27B; text/image; Ollama 0.35.1+; Apache 2.0. Larger memory requirement. |
| [Perplexity pplx-decider](https://ollama.com/library/pplx-decider) | `pplx-decider` | 27B; text/image; GGUF; Apache 2.0. Larger memory requirement. |
| [Kev tags](https://ollama.com/library/kev/tags) | `kev:0.8b-q8_0`, `kev:4b-q4_K_M`, `kev:9b-q4_K_M`, `kev:27b-nvfp4` | Ollama 0.40.4+; Apache 2.0. The first three are explicitly published GGUF variants. The family README describes MLX and its default `kev` alias; the 27B package selected here requires Apple silicon. Tag metadata and the family README differ, so actual server execution must establish availability. |
| [Strands Decider](https://ollama.com/library/strands-decider) | `strands-decider` | 2B; Ollama 0.40+ on an Apple silicon server; MLX only; 4,096-token window; Apache 2.0. |

Kev's README describes probabilities rounded to four decimal places. The application preserves what it receives and retains its existing `1e-6` probability-sum tolerance. A response outside that tolerance is a recorded failure; the suite doesn't renormalize or loosen validation to obtain a passing result.

Ordinary generation models, such as the installed Qwen, Mistral, and DeepSeek packages, aren't added merely because they can classify with a prompt. Suite inspection requires the `decision` capability and every inference uses `/v1/systemone`. Models that generate structured text would change the experiment's API contract.

`clef:cloud` can be selected explicitly against a signed-in Ollama server supporting that route. It isn't in the local default catalog because it uses a hosted execution route. No model aliases, cloud routes, or quantizations are silently substituted. Platform requirements apply to the Ollama server, which may be on another machine, rather than the machine running this CLI.

## Verification record

All 67 offline tests and syntax checks for 23 JavaScript files pass. Tests cover every catalog selection against the full current dataset, identical input and questions, serial execution, probability preservation, isolated saved files, repeated runs, unavailable models, failed-case denominators, and offline comparison integrity. Mocked tests establish application behavior; the measurements below come from real requests.

The local server is Ollama 0.40.6 on Windows, with an NVIDIA RTX 5060 Ti (16 GB) and about 32 GiB system memory. All 14 Windows-compatible catalog packages are installed and verified in [the package inventory](../results/ollama-installed-models.json). Installation was attempted for every catalog tag. The server rejected `kev:27b-nvfp4` and `strands-decider` because its MLX runtime is unavailable. Both stay selectable for a compatible server and have no invented accuracy or timing.

The benchmark contains 1,946 rows: 139 cases for each of 14 measured models. Thirteen models completed every case. English Laya completed 70 and failed 69; failures remain in both accuracy denominators. Every model received the same full evidence and shared questions, with the same 0.5 attention threshold. Returned probabilities were saved without rounding or adjustment.

| Model | Completed cases and failures | Category correct | Attention correct | Mean request time |
| --- | --- | ---: | ---: | ---: |
| `d1` | 139/139; 0 failed | 118/139 (84.9%) | 101/139 (72.7%) | 98.28 ms |
| `tev1:0.8b` | 139/139; 0 failed | 103/139 (74.1%) | 73/139 (52.5%) | 74.49 ms |
| `tev1:4b` | 139/139; 0 failed | 120/139 (86.3%) | 134/139 (96.4%) | 197.86 ms |
| `nimble` | 139/139; 0 failed | 113/139 (81.3%) | 112/139 (80.6%) | 404.66 ms |
| `nimble-v3` | 139/139; 0 failed | 124/139 (89.2%) | 135/139 (97.1%) | 432.23 ms |
| `laya` | 70/139; 69 failed | 28/139 (20.1%) | 31/139 (22.3%) | 198.90 ms |
| `laya:322m-multilingual-bf16` | 139/139; 0 failed | 54/139 (38.8%) | 64/139 (46.0%) | 54.54 ms |
| `laya:421m-typed-decisions-bf16` | 139/139; 0 failed | 82/139 (59.0%) | 67/139 (48.2%) | 98.72 ms |
| `clef-flash` | 139/139; 0 failed | 118/139 (84.9%) | 136/139 (97.8%) | 393.08 ms |
| `clef` | 139/139; 0 failed | 115/139 (82.7%) | 139/139 (100.0%) | 2069.98 ms |
| `pplx-decider` | 139/139; 0 failed | 126/139 (90.6%) | 139/139 (100.0%) | 3617.90 ms |
| `kev:0.8b-q8_0` | 139/139; 0 failed | 114/139 (82.0%) | 77/139 (55.4%) | 178.99 ms |
| `kev:4b-q4_K_M` | 139/139; 0 failed | 115/139 (82.7%) | 128/139 (92.1%) | 373.20 ms |
| `kev:9b-q4_K_M` | 139/139; 0 failed | 121/139 (87.1%) | 131/139 (94.2%) | 407.24 ms |
| `kev:27b-nvfp4` | Not run: MLX unavailable | Unavailable | Unavailable | Unavailable |
| `strands-decider` | Not run: MLX unavailable | Unavailable | Unavailable | Unavailable |

`pplx-decider` had the highest observed category accuracy, 126/139 (90.6%), and correct attention decisions for all 139 cases. Clef also got every attention decision correct. These are scores on synthetic evidence with a single author label review; independent human annotation and production validation remain pending.

English `laya` sets `num_ctx=512`, although its architecture metadata lists 8,192. The active runner confirmed a 512-token context and rejected 69 complete incident requests with HTTP 400. One separate diagnostic reproduction for incident `b5c49a9f6dac2938` confirmed the context-length error; [the diagnostic](../results/laya-diagnostic.json) is excluded from benchmark scoring. Both sibling Laya checkpoints completed every request. The default context was retained and no evidence was shortened.

Requests ran sequentially within each model, and models were measured sequentially. The first request is included, with no warmup or inference retry. A server interruption required continuations that evaluated only entries without prior measurements; completed model runs were retained. Installation retries are recorded separately. Downloads overlapped some measurements, while loading and cache state varied. Clef and pplx-decider used CPU/GPU offloading. These timings do not establish a repeatable speed ranking.

The final [consolidated manifest](../results/ollama-suite-consolidated-UlFS9R/suite.json) references the original per-model files. [The latest manifest](../results/ollama-suite.json) and [offline analysis](../results/ollama-comparison.json) support `npm run compare:ollama`. The analysis includes split and family diagnostics for every measured model. Comparison validates against the frozen current dataset and decision definitions; it returns exit code 1 because English Laya is partial and two catalog packages are unavailable. This is a reported completeness limit. It does not prevent viewing the measured results.

Download recovery retained all valid cached data after Ollama restarted. Twelve empty or missing part metadata records were backed up and reconstructed conservatively, with zero completed bytes for damaged parts; valid progress and weight-file bytes were preserved. Native Ollama downloads then completed and verified the packages. See [the cache repair report](../results/ollama-cache-repair.json), [installation history](../results/ollama-model-installation.json), and [retry history](../results/ollama-download-retries.json).

The dataset SHA-256 remains `ecaa6833741951c8eeffc0c42dc7b1b5205dd29e620e8ae032f5397f2c222e1b`. The original `results/ollama.json` and `results/openai.json` are unchanged. Earlier suite files remain available; this comparison uses one full pass per measured model and does not replace individual predictions with results from another run.
