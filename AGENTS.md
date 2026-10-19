# AGENTS.md

## Purpose and scope

This repository contains a small command-line experiment for AWS incident classification. It compares Ollama decision models, with Liquid AI d1-3B as the default, and OpenAI `gpt-6-luna` through the Decisions API, using the same incidents and decision definitions.

These instructions apply throughout the repository. Follow any more specific `AGENTS.md` in a subdirectory when working there, together with the user's current instructions.

The CLI, provider adapters, shared decisions, dataset, offline comparison, and tests are implemented. Use [docs/tasks.md](docs/tasks.md) for current work and verification status. Keep changes within the user's requested scope.

## Project boundaries

- Use Node.js 24 or later and plain JavaScript with ES modules.
- Keep dependencies minimal. Prefer built-in `fetch`, environment-file loading, file operations, timing, and the Node.js test runner.
- Keep functions short and readable. Use small modules only where they make the code easier to follow.
- Build a CLI only. Do not add a frontend, database, Docker, AWS infrastructure, monitoring tools. Logging should be minimal
- Do not introduce provider frameworks, classes, configuration layers, or other abstractions without a concrete need.
- Do not replace requested models or APIs to work around an integration problem. Explain the problem and retain the requested scope.

## Repository layout

| Path                  | Responsibility                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `main.js`             | Default evaluation entry point; `node main.js` must work.               |
| `evaluation.js`       | Sequential evaluation, scoring, display, and saved results.            |
| `compare.js`          | Compare saved evaluations without calling either provider.              |
| `analysis.js`         | Offline confusion, split/family scores, probability coverage, and latency summaries. |
| `config.js`           | Load `.env` and validate the selected provider's settings.              |
| `ollama-models.js`    | Dated decision model catalog and explicit model-list parsing.           |
| `ollama-suite.js`     | Sequential Ollama model suites, isolated results, and offline comparison. |
| `decisions.js`        | Shared question wording, category descriptions, and input construction. |
| `providers/ollama.js` | Ollama request and response handling.                                   |
| `providers/openai.js` | OpenAI request and response handling.                                   |
| `data/incidents.json` | Versioned synthetic log evidence with expected labels; currently 139 incidents. |
| `data/incident-notes.json` | Evaluation-only profiles, scenario families, splits, and label rationales. |
| `data/build-incidents.js` | Deterministic offline dataset authoring; never part of an evaluation run. |
| `docs/dataset.md`     | Source-format profiles, references, coverage, and review limits.         |
| `results/`            | Generated provider evaluations, excluded from version control.          |
| `test/`               | Focused checks that work without credentials or running models.         |
| `docs/tasks.md`       | Implementation checklist and acceptance criteria.                       |

This layout is a guide. Avoid adding files when an existing small module is enough.

## Configuration contract

Keep these values in `.env.example`:

```dotenv
MODEL_PROVIDER=ollama

OLLAMA_MODEL=d1
OLLAMA_BASE_URL=http://localhost:11434

OPENAI_MODEL=gpt-6-luna
OPENAI_API_KEY=
```

Changing only `MODEL_PROVIDER` must select the adapter. Require an OpenAI key only when the selected provider is `openai`. Load `.env` inside the application so direct execution with `node main.js` behaves like `npm run eval`.

Optional `OLLAMA_EVAL_MODELS=all` or a comma-separated tag list selects suite mode when Ollama is selected. Empty or absent `OLLAMA_EVAL_MODELS` retains single-model `OLLAMA_MODEL` behavior. `--models` overrides the list. Keep `.env.example`'s original required values and its documented optional suite setting.

## Decision API requirements

Use actual decision endpoints. Do not use chat completions, text-generation endpoints, or prompts that ask for JSON.

| Provider | Request                                                                | Question types                                     | Response mapping                                                                                              |
| -------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Ollama   | `POST /v1/systemone`, `state`, named `questions` object                | `choice` with `criteria`; `noul` for attention     | Named `answers`; choice probability map; `noul` gives the true probability.                                   |
| OpenAI   | `POST https://api.openai.com/v1/decisions`, `input`, `questions` array | `choice` with `choices`; `predicate` for attention | Match answers by name; map choice probabilities by value; predicate `probability` gives the true probability. |

Read the official references before changing adapter contracts:

- [Ollama d1](https://ollama.com/library/d1)
- [Ollama decision API](https://docs.ollama.com/capabilities/decision)
- [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions)

Keep shared question text, category descriptions, and attention criteria in one place. Adapters may translate the wire format without changing the meaning. Send both questions in one request per incident.

## Evaluation rules

- Use exactly these categories: `throttling`, `authentication`, `dependency_failure`, and `other`.
- Define attention using customer impact and available evidence. A category alone must not determine urgency.
- Send identical incident evidence to both providers. Expected labels are evaluation data and must never be included in model input.
- Use stable opaque incident IDs. Keep scenario families, profile associations, label rationales, and split notes outside model input. Keep related variants in the same split.
- Validate a nonempty dataset and derive counts from it. Maintain at least 120 distinct scenarios in the repository dataset; small temporary fixtures may have different sizes. Follow `docs/dataset.md` when editing log evidence, then regenerate and validate the dataset and evaluation-only notes together.
- Normalize decisions to `category`, `categoryProbabilities`, `requiresAttentionProbability`, and `requiresAttention`.
- Preserve returned probability values. Do not round saved values, fill missing categories with zero, renormalize, or substitute confidence scores for probabilities.
- Use `requiresAttentionProbability >= 0.5` for the boolean decision. Missing probability means an unavailable decision, never an invented probability or `false`.
- Process all incidents sequentially in dataset order. Do not add hidden retries, warm-up calls, or provider-specific input changes.
- Show and save errors clearly. Never silently remove failed incidents from accuracy denominators or present incomplete results as a complete evaluation.
- Keep comparison offline. Check that saved evaluations use the same dataset, decision definitions, threshold, and scoring rules before comparing them.

## Commands and validation

Run these commands from the project directory:

```text
npm install
node main.js
npm run eval
npm run compare
npm test
```

Use `npm run eval` for the selected provider and `npm run compare` for `results/ollama.json` and `results/openai.json`. `npm test` must run offline through `node --test`.

Use `npm run models:ollama` to list the dated catalog, `npm run eval:ollama` to evaluate it with Ollama selected, and `npm run compare:ollama` to compare the latest suite offline. Suite results live in new `results/ollama-suite-*/` directories and preserve the two single-provider files. Inspect metadata without inference before each model; never claim unavailable models were measured or silently skip them from suite status. See [docs/ollama-models.md](docs/ollama-models.md) for scope and platform limits.

Add focused tests for provider contracts, normalization, the threshold boundary, evaluation arithmetic, and failure handling. Mock HTTP using built-in facilities. Never contact external APIs in the default test suite. Run appropriate local checks and report which checks passed, failed, or could not run. Do not claim a live model was verified without a real request.

## Secrets and generated files

Never commit API keys. Ignore `.env`, other private environment files, `node_modules/`, and generated `results/`, while keeping `.env.example` tracked. Do not print authorization headers, environment dumps, or keys in errors, fixtures, screenshots, or saved results. Use synthetic incidents only.

## Work tracking

Treat [docs/tasks.md](docs/tasks.md) as the source of truth for planned and active work. Before starting a task, check whether it is recorded there. If it is missing, add it there first, including the relevant acceptance checks, then begin the work. Follow the task-entry convention documented in `docs/tasks.md` every time work is added. Keep the checklist current throughout the task, and mark work complete only after its acceptance checks pass. Update it whenever scope, progress, or verification status changes so it always reflects the current state of the project.

## Working style

Keep changes within the requested scope and preserve existing user work. Update [docs/tasks.md](docs/tasks.md) as tasks are completed, marking completion only after the corresponding acceptance checks pass.

Write documentation and user messages in plain language with varied sentence lengths. Follow any additional wording restrictions supplied by the user. Avoid em dash punctuation, slogans, decorative bullets, self-answered questions, and repeated closing statements. Describe changes and verification directly.
