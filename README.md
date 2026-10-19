# AWS incident decision experiment

This command-line experiment runs 139 synthetic AWS incidents through Ollama decision models or OpenAI `gpt-6-luna` through the Decisions API. The default Ollama model is Liquid AI d1-3B. Both providers receive the same incident evidence and shared decision definitions. The project has no third-party runtime dependencies.

Dataset `synthetic-aws-v3` covers Lambda, DynamoDB, SQS, API Gateway, RDS PostgreSQL 16, and RDS MySQL 8.0.44. Descriptions contain multiline log evidence with labeled source boundaries and separate operational observations available at the decision cutoff. IDs are opaque. Profile settings, official format references, coverage, and label-review limits are in [the dataset documentation](docs/dataset.md). All values are manufactured; none are private AWS captures. Earlier dataset measurements are historical.

## Requirements and setup

Install Node.js 24 or later. From the project directory, install the package and copy the example settings file:

```sh
npm install
```

Copy `.env.example` to `.env`, then edit `.env` for the provider you want to run. The default settings select Ollama with model `d1` at `http://localhost:11434`. Keep `OPENAI_MODEL=gpt-6-luna` when using OpenAI. Set `OPENAI_API_KEY` in `.env`; the key is required only when `MODEL_PROVIDER=openai`. `.env` is ignored by Git. Do not commit it.

Change `MODEL_PROVIDER` to `ollama` or `openai` to select an adapter. The other provider settings can stay in the file.

## Set up Ollama and check d1

Install Ollama v0.35.0 or later, which supports the local `/v1/systemone` decision endpoint, then download d1:

```sh
ollama pull d1
```

Ollama usually starts its local server during installation. If it is not running, start it in a separate terminal:

```sh
ollama serve
```

You can check d1 with a direct decision request. This PowerShell example sends a `choice` question and a `noul` question together, as the evaluator does:

```powershell
$body = @'
{
  "model": "d1",
  "state": "The production checkout Lambda has reached its concurrency quota. Customer requests are still failing with sustained 5xx responses.",
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "Which category best describes the primary cause?",
      "criteria": {
        "throttling": "Requests or work are limited by a rate, quota, throughput, or concurrency limit.",
        "authentication": "Identity, credentials, tokens, signatures, or access permissions prevent the operation.",
        "dependency_failure": "A downstream service or dependency is unavailable, failing, or timing out without stronger evidence for throttling or access failure.",
        "other": "The evidence points to another cause or does not support the categories above."
      }
    },
    "requires_attention": {
      "type": "noul",
      "instructions": "Does this incident require immediate attention based on customer impact and available evidence?",
      "criteria": {
        "true": "Investigate now because evidence indicates ongoing or imminent material customer harm.",
        "false": "A recovered isolated error or brief retry without material impact generally does not require immediate attention."
      }
    }
  }
}
'@
Invoke-RestMethod -Uri 'http://localhost:11434/v1/systemone' -Method Post -ContentType 'application/json' -Body $body
```

A successful response has named `answers`. The category answer returns a selected `choice` and its probability map. The attention answer returns `noul`, the probability that the answer is true. The [d1 model page](https://ollama.com/library/d1) and [Ollama decision API guide](https://docs.ollama.com/capabilities/decision) have more examples.

## Run evaluations

With `MODEL_PROVIDER=ollama` in `.env`, either command runs the same evaluation:

```sh
node main.js
npm run eval
```

To evaluate with OpenAI, set `MODEL_PROVIDER=openai` and add the API key to `.env`, then run `npm run eval`. Change the provider back to `ollama` and run the command again for the local evaluation. Each run processes incidents in dataset order and writes `results/ollama.json` or `results/openai.json`.

The evaluation prints each incident's decision, probabilities, expected outcomes, correctness, and request time. It continues after a request error, writes an error row, and exits with a nonzero status if a request fails or a required decision is unavailable.

## Evaluate multiple Ollama models

Keep `MODEL_PROVIDER=ollama`. List the built-in model catalog and its platform requirements:

```sh
npm run models:ollama
```

The catalog covers d1, both Tev1 sizes, Nimble, Nimble v3, three Laya checkpoints, Clef Flash, Clef, pplx-decider, four Kev sizes, and Strands Decider. The [model assessment](docs/ollama-models.md) lists the exact tags, official references, licensing, and dataset limits. Quantization aliases aren't separate model families. You can select other decision-capable tags, including custom namespaces, explicitly.

Install the models you want on the configured Ollama server, for example:

```sh
ollama pull tev1:0.8b
ollama pull tev1:4b
ollama pull nimble
```

Evaluate a subset or the entire catalog:

```sh
npm run eval -- --models d1,tev1:0.8b,tev1:4b,nimble
npm run eval:ollama
```

For repeated use with `node main.js` or `npm run eval`, set `OLLAMA_EVAL_MODELS=d1,tev1:4b,nimble` or `OLLAMA_EVAL_MODELS=all` in `.env`. An empty or absent value keeps the original single-model `OLLAMA_MODEL` behavior. `--models` overrides `OLLAMA_EVAL_MODELS`. OpenAI ignores the Ollama suite setting; an explicit `--models` command requires Ollama to be selected. Ollama's separate `OLLAMA_MODELS` storage-directory setting is not used for evaluation selection.

The suite snapshots the validated dataset before inference. It evaluates each model, then each incident, sequentially, with the same two questions and threshold. No automatic downloads, warmups, retries, shortened inputs, or alternative endpoints are added. Each model is inspected with `/api/show` first; missing installations and models without the `decision` capability are recorded as unavailable, with no invented accuracy or latency. Runtime errors remain per-incident failures in the full dataset denominator. Later models still run.

Every suite creates a new `results/ollama-suite-*/` directory containing the dataset snapshot, a `suite.json` manifest, and an `ollama.json` result under a separate directory for each measured model. It preserves `results/ollama.json`, `results/openai.json`, and earlier suites. `results/ollama-suite.json` identifies the latest suite and is updated after every model, so unfinished suites remain visible. A missing model or incomplete evaluation makes the suite exit with a nonzero status.

The CLI compares suite results after inference and saves `ollama-comparison.json` beside that suite's manifest. To compare the latest suite again without contacting Ollama or loading credentials:

```sh
npm run compare:ollama
```

The offline comparison checks the current dataset, saved incident evidence, decision definitions, probability validation, threshold, and scoring rules. It prints every measured model's accuracy and latency, identifies unavailable or unfinished models, and saves the existing split/family/confusion and probability diagnostics per model. Partial suites stay labeled incomplete. The original `npm run compare` still compares the two single-provider result files.

## Compare saved evaluations

After evaluating both providers, run:

```sh
npm run compare
```

Comparison is offline. It needs both result files and checks their dataset, decision definitions, threshold, and scoring rules against each other and the current source. Two compatible old files are rejected as stale. If a file is missing or invalid, the command names the provider to rerun. Generated results are ignored by Git.

After changing the dataset, regenerate both provider files: select Ollama and run `npm run eval`, then select OpenAI and repeat. Each evaluation makes 139 sequential requests with two questions per request. `npm run compare` prints development and held-out scores and attention false alarms/misses, and saves `results/comparison.json` with category confusion, per-family scores, Brier scores with probability coverage, and latency percentiles. Notes must match the measured dataset hash, IDs, labels, and family splits. Unavailable positive attention decisions remain in recall's denominator; their count is shown separately from explicit negative predictions. Brier scores use available attention probabilities and complete valid category maps only, with no filling of absent values. Percentiles use nearest rank and include failed attempts.

For an explicitly historical comparison of the two default result files, use `npm run compare -- --historical`. It checks the saved pair, labels the output historical, and skips current-source and notes checks. It cannot report current split scores. Preserve older measurements in a separate directory before regenerating; Task 18 archived the earlier pair under `results/archive-before-v3-*`.

For dataset maintenance, edit the scenario table in `data/build-incidents.js`, run `node data/build-incidents.js`, and then run `npm test`. The builder deterministically regenerates the incidents and evaluation-only notes together. It never runs during evaluation. The evaluator accepts any validated nonempty dataset size, while repository checks require at least 120 scenarios and both attention outcomes per mechanism family. Use development cases for future prompt work and keep reserved families out of score-driven changes. Full-dataset evaluation includes reserved cases; inspecting that score during tuning exposes them. Independent human annotation is pending. Public cases and matched variants from shared authorship do not form a blind test or 139 independent mechanisms.

## Saved decisions and metrics

Each normalized decision contains these fields:

| Field | Meaning |
| --- | --- |
| `category` | Selected category: `throttling`, `authentication`, `dependency_failure`, or `other`. |
| `categoryProbabilities` | The category probabilities returned by the provider, or `null` if it returned no map. Missing entries stay missing. |
| `requiresAttentionProbability` | The provider's probability that immediate attention is required, or `null` when unavailable. |
| `requiresAttention` | `true` at a probability of `0.5` or above, `false` below `0.5`, or `null` when the probability is unavailable. |

The evaluator preserves returned probabilities without rounding, filling absent values, or changing their sum. A complete category map must sum to one within an absolute tolerance of `1e-6`; a partial map may not exceed one by more than that tolerance. Invalid mass creates an error row. A missing attention probability leaves that decision unavailable. An invalid response, refusal, missing required answer, or unknown category also creates an error row. Failed and partial rows stay in the saved results.

Category and attention accuracy use the full validated dataset count as the denominator, currently 139. Failed or unavailable decisions add no correct answers. The average latency uses timed attempts, including failed requests, and is saved in milliseconds. Local model loading and network conditions affect latency. The input includes a supplied operations worksheet, so raw-log triage is unmeasured. Synthetic coverage and a single run do not establish production prevalence, production accuracy, calibrated probabilities, or a repeatable latency ranking.

Run the offline test suite with:

```sh
npm test
```

The tests use local fixtures and mocked requests. They do not require credentials, Ollama, or external API access.

## Troubleshooting

- If Ollama reports a connection error, check `OLLAMA_BASE_URL`, confirm the server is running, and try `ollama serve` in another terminal.
- If Ollama returns 404, update to a version that supports `/v1/systemone` and check that the selected model is installed with `ollama list`. Run `ollama pull d1` to install the default model.
- For OpenAI 401 errors, check that `OPENAI_API_KEY` is set in `.env`. For 403 or 404 errors, confirm that the account can use the Decisions API and `gpt-6-luna`. A 429 response indicates a rate limit or quota issue.
- Malformed or refused provider responses are reported for the affected incident and make the evaluation exit with an error status. The CLI does not retry with a different API or ask a model to generate JSON.
- If comparison reports a missing result file, set `MODEL_PROVIDER` to that provider and run `npm run eval` before comparing again.

## API references

- [Ollama d1 model](https://ollama.com/library/d1)
- [Ollama decision API](https://docs.ollama.com/capabilities/decision)
- [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions)
