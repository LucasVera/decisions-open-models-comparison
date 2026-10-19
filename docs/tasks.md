# Implementation tasks

## Status and target

The CLI is implemented, and Task 12's setup and live verification checks have passed for both providers. Findings R1 and R2 from Task 14's review are resolved: both adapters distinguish response-body transport errors from malformed JSON, real HTTP checks cover timeouts and interrupted responses, and `AGENTS.md` describes the implemented project. Tasks 6, 7, and 11 and the initial documentation checklist are complete. Task 14 recorded passing results for 39 offline checks, syntax checks for 15 JavaScript files, and the historical saved-result comparison. See [task-review.md](task-review.md) for the findings and resolution evidence.

Task 15's evaluation-validity review is complete. See [evaluation-review.md](evaluation-review.md) for reproduced dataset shortcuts, probability-validation findings, and a proposed usefulness study.

Task 16 delivered `synthetic-aws-v2` with 120 synthetic incidents. Task 17 reopened its MySQL fidelity and format-validation acceptance items, which Task 18 has now corrected and verified. Historical Task 16 measurements and test counts remain recorded below.

Task 17's review and Task 18's technical fixes are complete. [test-data-review.md](test-data-review.md) retains the original findings and records each correction. Current data is `synthetic-aws-v3`, with 139 cases and both attention outcomes in every mechanism family. All 58 offline checks, syntax checks for 19 files, the deterministic rebuild, and the scoring-mutation check pass. Both providers completed fresh 139-case runs without failures, and current comparison passes with offline split/family diagnostics. Independent human annotation and production validation remain pending and are not claimed as completed.

Task 19 is complete. Optional Ollama suites support 16 catalog entries with isolated results. All 67 offline tests and syntax checks for 23 files pass. Fourteen Windows-compatible packages are installed and measured over 139 cases each; thirteen runs are complete and English Laya has 69 recorded context-length failures. Two MLX-only packages were rejected by this server. The final offline comparison records these limits, and the original provider measurements and frozen v3 dataset are preserved.

The target is a small Node.js CLI that evaluates the same synthetic AWS incidents with local Liquid AI d1-3B through Ollama and OpenAI `gpt-6-luna` through the Decisions API, then compares saved results. The current dataset contains 139 incidents across six primary source groups. Historical records below describe earlier dataset versions where stated.

- [x] Create repository agent instructions in `AGENTS.md`.
- [x] Record the implementation tasks and acceptance checks in `docs/tasks.md`.
- [x] Document a consistent convention for adding and tracking work in this checklist.
- [x] Update the outdated documentation-only status and planned-command wording in `AGENTS.md` to reflect the implemented CLI.

Acceptance: `AGENTS.md` points agents to this convention and accurately describes the implemented project; this file defines the section, checkbox, and acceptance-check format for future tasks.

## Task entry convention

Keep every planned or active task in a numbered, descriptive section. Add work as unchecked checkbox items (`- [ ]`) written as clear actions. Give each section an `Acceptance:` statement that describes observable conditions for completion. Group related actions in the same section, place new sections in the order work should happen, and avoid duplicating tasks already recorded elsewhere. Mark an item `[x]` only after its acceptance conditions pass; revise the checklist when scope or status changes.

Use this pattern for new sections:

```markdown
## N. Descriptive task title

- [ ] Action to complete.
- [ ] Another related action, if needed.

Acceptance: observable checks that show the section is complete.
```

If the work fits an existing section, add the checkbox there and update that section's acceptance statement when needed. For documentation-only work that does not fit an implementation section, add a section near the top of this checklist using the same pattern.

Work through the sections in order. The two adapters can be implemented independently after the shared definitions are settled. Keep the project small; the checklist does not require extra architecture.

## 19. Evaluate multiple Ollama decision models

- [x] Review current incident evidence and official model contracts; record eligible model families, distinct sizes, platform requirements, and licensing limits.
- [x] Add Ollama model selection and a sequential suite using identical evidence and questions, with separate saved results and explicit missing or unsupported model failures.
- [x] Extend offline comparison, documentation, and focused tests for model selection, result isolation, sequencing, and failure handling while retaining OpenAI behavior.
- [x] Run offline checks and available live Ollama evaluations; record measured results and any models that could not run.
- [x] Download all remaining catalog tags as authorized by the user, inspect the installed packages, and record any platform or download failures.
- [x] Run the expanded live suite over the frozen dataset and update the measured comparison and model assessment with all results and limits.

Acceptance: every documented compatible decision model family and distinct size can be selected without adapter changes. Ollama suite mode evaluates selected models sequentially over the frozen current dataset, preserves single-model usage and existing measurements, and saves per-model results plus an offline comparison. Every catalog tag has an installation attempt and an explicit outcome. Downloaded models receive a live evaluation when their runner is available on this server. Missing installations and platform limits remain visible; no unavailable model is reported as measured. Default tests remain offline.

Verification (2026-10-19): 16 representative checkpoint/size tags cover ten current families including d1. `OLLAMA_EVAL_MODELS` and `--models` select a suite; blank settings retain single-model behavior. All 67 offline tests and syntax checks for 23 JavaScript files pass, including a full 139-case mocked run for every catalog entry and CLI checks against a local fixture server. The original saved-provider comparison passes. All fourteen Windows-compatible packages are installed, with manifests verified in `results/ollama-installed-models.json`. The server rejected `kev:27b-nvfp4` and `strands-decider` because MLX is unavailable; neither has inference measurements.

Live verification contains 1,946 benchmark rows across fourteen measured models. Thirteen completed all 139 cases. English `laya` completed 70 cases and rejected 69 with HTTP 400 under its default 512-token context; one extra diagnostic request confirmed the cause and is excluded from scoring. Failed cases stay in the 139-case denominators. No input was shortened, context overridden, probability adjusted, or inference retried. `pplx-decider` scored 126/139 category and 139/139 attention; Clef also scored 139/139 attention. Full results and timing limits are in [ollama-models.md](ollama-models.md).

The final consolidated manifest is `results/ollama-suite-consolidated-UlFS9R/suite.json`; `results/ollama-suite.json` points to the same model results. `npm run compare:ollama` validates the saved evidence, definitions, threshold, and scoring and saves split/family diagnostics to `results/ollama-comparison.json`. Exit code 1 correctly reports the partial Laya run and two unavailable catalog entries. Single-pass timings include the first request and sometimes background downloads; no repeatable speed or production-quality claim is made.

Recovery is complete. A Kev 0.8B installation retry resolved HTTP 503. Ollama later restarted during downloads, leaving twelve empty or missing part metadata records across Clef, pplx-decider, and Kev 9B. Original metadata was backed up under `results/ollama-cache-repair-gq3yue`; damaged or absent records were reconstructed with zero completed bytes for those parts. Valid progress and weight bytes were retained, preserving about 28 GB of download progress. Native downloads completed and verified each package. Installation attempts and retries are retained in `results/ollama-model-installation.json`, `results/ollama-download-retries.json`, and `results/ollama-cache-repair.json`.

Continuations measured only entries without prior results, using the original suite snapshot. The final comparison retains completed runs from `results/ollama-suite-KW1RL9`, `results/ollama-suite-mv0fXg`, and `results/ollama-suite-Qn4Ftd`. The frozen v3 dataset, shared decision definitions, and both original provider result files have unchanged hashes. Earlier measurements remain preserved. Independent human annotation and production validation remain pending.

## 18. Fix the current tests and dataset review findings

- [x] Close R1 with wrong-category scoring and saved-result corruption checks, and verify the scoring mutation is detected.
- [x] Close R2/R5 with MySQL configuration-aware evidence, accurate client messages, service-specific identifiers and operation/error/status checks, and semantic corruption fixtures.
- [x] Close R3 by validating complete and partial probability totals without modifying returned values; cover normalization, evaluation, and saved results.
- [x] Address R4 with harm/recovery counterexamples, varied timestamps and renderings, family-preserving splits, and recorded label-review limits; regenerate data and notes together.
- [x] Address R6 with current-dataset comparison checks, offline split/family/confusion metrics, refreshed provider measurements where available, and explicit verification limits.
- [x] Run the offline suite, syntax checks, deterministic rebuild and targeted mutation checks; update the dataset guide, README, and review resolutions.

Verification (2026-10-19): all 58 offline checks pass under Node.js v24.22.0. Syntax checks pass for 19 files, both JSON files rebuild byte for byte, and the previously surviving scoring mutation fails the new wrong-category test. Profiles reject source-semantic and logging-configuration corruption. Version `synthetic-aws-v3` has 139 cases, 30 families with both attention outcomes, 106 development cases and 33 held-out cases, SHA-256 `ecaa6833741951c8eeffc0c42dc7b1b5205dd29e620e8ae032f5397f2c222e1b`. Labels and questions were frozen before inference. Fresh live runs completed all 139 rows for each provider without failures: Ollama scored 118/139 category and 101/139 attention (29 false alarms, nine misses, 115.784735971223 ms mean latency); OpenAI scored 123/139 category and 139/139 attention (zero false alarms or misses, 259.08923525179887 ms mean latency). Earlier measured files were archived under `results/archive-before-v3-4B7fky`. `npm run compare` passes against current source and saves full diagnostics to `results/comparison.json`. No prompts or labels were changed after examining these outputs. Independent human review, production validation, option-order/wording sensitivity, and repeatable speed ranking remain unverified.

Acceptance: each review finding has a tested correction or an explicit external limitation. The CLI retains the requested models/endpoints, identical provider input, sequential calls, four categories, and 0.5 threshold. Invalid probability mass and stale default comparisons are rejected; wrong predictions are scored and validated accurately. Generated evidence agrees with its declared profiles, each represented mechanism has harm/recovery counterexamples in one split, and measured results are distinguished from fixtures and missing verification. Independent human annotation and production performance must not be claimed without evidence.

## 17. Review current tests, dataset bias, and AWS log fidelity

- [x] Review the current implementation and offline tests; run the suite and syntax checks without provider requests.
- [x] Measure dataset shortcuts, label support, split independence, and coverage; verify representative log formats against official AWS and engine documentation.
- [x] Record reproduced findings, source locations, test gaps, and verification limits in a current review document, then report the assessment.

Verification (2026-10-19): all 48 offline checks and syntax checks for 17 files passed under Node.js v24.22.0. A temporary mutation scoring every returned category as correct also passed all 48 checks; a separate wrong-category fixture confirmed the original scorer behaves correctly. Reproduced acceptance of category probability totals of 3.6 by normalization, evaluation, and saved-result validation, and acceptance of an impossible service/operation/status combination by the caller profile validator. Regeneration in a temporary copy matched both JSON files byte for byte. Checked native formats against official AWS, PostgreSQL, and MySQL references; identified a shipped MySQL configuration/statement mismatch. Both historical result files remain compatible with each other but contain 12 cases and differ from the current dataset hash. Findings and follow-up checks are in [test-data-review.md](test-data-review.md). No application code, incident data, or saved measurements changed.

Acceptance: the review covers the expanded 120-case dataset and current test suite, distinguishes test correctness from model quality, supports findings with reproducible checks and official format references, and states what remains unverified. Application code, incident evidence, and measured results are preserved.

## 16. Expand the synthetic incident dataset with realistic AWS logs

Clarification (2026-10-19): log-format fidelity is required. Each excerpt must match the structure and fields that its stated AWS service, runtime, database engine, and logging configuration would produce. Scenarios and data values are manufactured; field names, prefixes, event boundaries, and message conventions must follow the documented source format.

- [x] Expand `data/incidents.json` to at least 120 distinct synthetic incidents. Keep `description` as a string containing multiline log evidence. Retain the existing expected-label fields, and count different underlying scenarios rather than copies with changed timestamps or identifiers.
- [x] Define documented log-format profiles before writing the incidents. For each profile, record the service, runtime or engine version, log type, relevant logging settings, capture method, and official format references. Associate every excerpt with a profile in evaluation-only notes. Use manufactured values with valid shapes, units, and relationships; do not copy private logs or include credentials, customer data, or real account details.
- [x] Make Lambda excerpts match the selected runtime and text or JSON configuration. Separate platform events from application messages. Where the selected format and invocation lifecycle call for them, reproduce the documented `START`, `END`, and `REPORT` records or their structured equivalents, with correct request-ID relationships, duration/memory units, and conditional fields. Application log prefixes, exceptions, stack traces, and JSON field names must match the declared runtime/logger. Include surrounding normal activity where appropriate, and avoid adding invocation records for events that prevented the function from running.
- [x] Make RDS PostgreSQL excerpts match the declared engine version, log destination, and `log_line_prefix`, including timestamp, session/process identity, user/database fields, severity, and continuation records as applicable. Use engine-valid error messages and codes, with SQLSTATE shown only when the selected format/settings emit it. Make RDS MySQL excerpts follow the selected native error, general, or slow-query log format and its enabling settings. Do not replace native database output with a shared invented AWS record structure.
- [x] Match API Gateway access logs to an explicit supported access-log template and its context fields; treat execution logs as their own format. Represent DynamoDB and SQS client errors through a declared SDK/application logger, distinguishing caller logs from service-generated records. Keep optional fields and values consistent with the selected source, settings, and failure path.
- [x] Specify whether each excerpt represents raw log messages, a console/CLI rendering, or an API/export capture. Preserve that view's documented event boundaries, timestamps, escaping, delimiters, and metadata placement. Keep CloudWatch transport metadata separate from native message content. When several sources or metrics appear in one description, label the source boundaries and preserve each source's format; do not insert analysis or invented metric lines into native log records.
- [x] Add offline format checks for every supported profile using small documented reference examples and synthetic fixtures. Parse JSON events where applicable; check required fields, prefix shapes, units, optional-field conditions, and event boundaries for the selected format. Verify correlated IDs, session continuity, plausible time ordering, and consistent duration/memory values. Review representative excerpts from every profile against official examples, recording the reference and any application-defined fields. Do not claim that a schema check alone proves AWS emitted a manufactured event.
- [x] Describe each incident through evidence available at the decision time. Include observed metric or operational-context lines when logs alone cannot establish customer impact. Avoid prose that supplies the diagnosis or expected urgency. Include ongoing failures, recovered retries, successful fallbacks, misleading error symptoms, and uncertain causes, with expectations supported by the visible evidence and shared policy.
- [x] Document a coverage matrix by log source, category, attention outcome, and difficulty. Cover all four existing categories and both attention outcomes within every category, including production cases without material impact. Avoid making a service name, environment, error keyword, or excerpt length a reliable substitute for the decision. State that this synthetic coverage does not establish production prevalence.
- [x] Replace descriptive incident IDs with stable opaque identifiers. Keep expected labels, label rationales, scenario-family information, and coverage notes outside model input. Verify that both adapters receive identical evidence, including its line breaks and ordering, without hidden provider-specific truncation.
- [x] Review expected labels against the shared decision definitions before examining provider answers. Record the evidence supporting each label in evaluation-only notes, resolve disputed cases, and identify independent cases reserved from prompt tuning. Keep related variants in the same development or held-out group so paraphrases cannot supply an apparent independent test.
- [x] Remove the fixed 12-record checks from evaluation and saved-result comparison. Derive counts, progress, metric denominators, and completeness checks from the validated nonempty dataset and actual result rows. Preserve sequential processing, visible failures, dataset identities, and rejection of comparisons between the old and expanded datasets. Keep the requested models, endpoints, categories, and 0.5 attention threshold.
- [x] Update offline checks and documentation, including `AGENTS.md` and the README. Check the expanded dataset's schema, unique opaque IDs, coverage, and label exclusion; exercise evaluation arithmetic and comparison with different dataset sizes, including a size above 12 and failed rows. Use mocked provider requests for the expanded run and verify every incident appears once. Record dataset version/count and instructions for regenerating both provider results. Keep fixtures separate from measured results and report any live verification separately.

Format references checked for this clarification: [Lambda runtime log examples](https://docs.aws.amazon.com/lambda/latest/dg/java-logging.html), [RDS PostgreSQL logging parameters](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.overview.parameter-groups.html), [RDS MySQL log types](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.MySQL.html), [API Gateway access-log templates](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-access-logging.html), and [CloudWatch GetLogEvents response structure](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_GetLogEvents.html). These are starting references; implementation must check the documentation for each version and profile actually chosen.

Verification (2026-10-19): `npm test` passed all 48 checks under Node.js v24.22.0, and `node --check` passed for 17 JavaScript files. Both adapters evaluated all 120 cases sequentially through mocked HTTP with exact shared input, unchanged line breaks, two questions per request, and every ID present once. Temporary fixtures covered dataset sizes 1, 7, 13, and 120, complete/partial/failed arithmetic, malformed/empty input, truncated/duplicate saved rows, and rejection of old/expanded comparisons. Profile fixtures and corruption checks cover native event boundaries, Lambda ID/report relationships, database prefixes and continuations, MySQL thread/timing correlations, JSON fields, gateway response paths, and decision cutoffs. Representative source review and coverage are recorded in [dataset.md](dataset.md); per-case reasons and resolutions are in `data/incident-notes.json`. Label review was a single author pass before inference, with 92 development cases and 28 reserved cases across 30 families; no independent human annotation is claimed.

Reopened by Task 17 and resolved by Task 18 (2026-10-19): incident `a6d810ec8d38f1be` now omits malformed SQL under `log_raw=OFF` and retains the complete selected client message. Configuration-aware, message-template, and service/operation/status regression checks pass. Both JSON files were regenerated together as v3. See the resolution record in [test-data-review.md](test-data-review.md).

Dataset identity: version `synthetic-aws-v2`, 120 cases, SHA-256 `71544b0772bd7bb298ca424ac6e8f3ec0c56c830d81ceaa5a604013e5a15c8fc`. The deterministic authoring source is `data/build-incidents.js`. Existing measured results still contain 12 cases and were not overwritten. Follow the README to regenerate Ollama and OpenAI results before comparing v2 scores. No live provider verification or production-accuracy claim is part of this task.

Acceptance: `data/incidents.json` contains at least 120 distinct synthetic incidents with multiline log evidence matching documented source-specific profiles, documented coverage of the listed log sources, and reviewed expectations supported by the supplied evidence. Each profile has official references, a representative format review, and passing offline structural checks; configurable, optional, and application-defined fields are identified accurately. All scenario/data values remain manufactured. Opaque IDs and evaluation-only notes do not reveal answers to either provider. Offline tests pass for variable dataset sizes and a full expanded-dataset fixture evaluation; counts and failure denominators are correct, and mismatched old/new results cannot be compared. Documentation reflects the expanded contract. Completing this task does not by itself establish accuracy on production incidents.

## 15. Review evaluation validity, usefulness, and bias

- [x] Inspect provider contracts, shared input, dataset labels, scoring, saved evidence, and offline checks.
- [x] Identify supported findings about bias, leakage, uncertainty, reproducibility, and practical value.
- [x] Record findings and a fair evaluation procedure in `docs/evaluation-review.md`, with source references and verification limits.

Verification (2026-10-17): `npm test` passed all 33 checks, syntax checks passed for all 14 JavaScript files, and `npm run compare` passed for both complete saved evaluations. Independently checked current dataset/definition hashes and derived metrics. Reproduced an ID-only rule matching all 12 attention labels and acceptance of a complete probability map summing to 3.6. Source links in the report resolve. No application code or saved results were changed, and this review made no inference requests. Task 14 separately records live verification; its updates were preserved.

Acceptance: the review distinguishes implementation checks from evidence of model quality, supports findings with repository locations or reproduced checks, explains what the 12 incidents can establish, and describes follow-up evaluation without changing application behavior or making inference requests.

## 14. Review each task and report implementation correctness

- [x] Review every task and its acceptance checks against source, documentation, and available saved evidence.
- [x] Run the offline test suite, syntax checks, and targeted checks for any suspected defects.
- [x] Write `docs/task-review.md` with a verdict for each task, supported findings, verification limits, and work needing attention.
- [x] Update checklist status where the review shows that acceptance checks remain unmet.

Progress (2026-10-17): reviewed Tasks 1 through 13, passed all 33 original offline checks and syntax checks for 14 files, verified setup and failure exits in a clean temporary copy, reproduced the response-body timeout defect in both adapters, and completed fresh live 12-incident evaluations for Ollama and OpenAI. The review preserved application source and existing results. The subsequent authorized fixes resolved R1 and R2, passed 39 offline checks and syntax checks for 15 files, and passed saved-result comparison. No new model calls were needed for these transport and documentation fixes. Task 15's separate review is complete.

Acceptance: the report covers Tasks 1 through 13 individually, separates reproduced defects from pending live verification, cites relevant files and checks, and identifies any follow-up work without changing application behavior.

## 13. Assess routing GPT-6 Luna through OpenRouter

- [x] Check the current HTTP implementation and official OpenRouter support for the same decision model and probability contract.
- [x] Estimate the code, configuration, comparison, and verification work without changing application behavior.

Assessment (2026-10-17): `providers/openai.js` already uses built-in `fetch`, and `package.json` has no SDK dependency. OpenRouter lists the same GPT-6 Luna decision model as `openai/gpt-6-luna-decisions`, served through `POST https://openrouter.ai/api/alpha/decisions` with an OpenRouter bearer key. See the [model page](https://openrouter.ai/openai/gpt-6-luna-decisions) and [provider endpoint listing](https://openrouter.ai/openai/gpt-6-luna-decisions/providers).

The [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) uses `input`, a questions array, `choices`, a `predicate`, and an answers array. OpenRouter's [Alpha.Decisions documentation](https://openrouter.ai/docs/client-sdks/typescript/sdks/decisions/README) uses `state`, named questions, `criteria`, and `noul`. Its [HTTP examples](https://openrouter.ai/blog/insights/what-is-jev/) show named answers, choice probability maps, and a `noul` probability. This resembles the existing Ollama adapter's format, but requires separate authentication, endpoint, and error handling. Keep shared incident evidence, question meaning, probability values, and the 0.5 threshold intact.

Estimated effort for replacing direct OpenAI access: 2 to 4 engineering hours, assuming working OpenRouter credentials and documented behavior. Allow 30 to 60 minutes for the adapter, 30 to 45 minutes for configuration and evaluation/comparison provider identities, 45 to 90 minutes for focused offline checks and documentation, and 15 to 30 minutes for a live evaluation of all 12 incidents and saved-result comparison. Update the environment example, README, and repository instructions with the implemented provider contract. Preserve sequential requests and the existing policy against hidden retries or model substitutions.

Verification: inspected the current source and official documentation. No application files were changed and no inference requests were made. OpenRouter labels this endpoint alpha; actual model access, returned probabilities, error behavior, and latency require a live check. The estimate does not claim identical numerical outputs or latency between routes.

Acceptance: record the supported model and endpoint, required request and response changes, an effort estimate, and any limits of documentation-only verification.

## 1. Confirm provider contracts

The requested endpoint and question formats were checked against the official references on 2026-10-17. Recheck them when implementation starts, since API details can change.

Confirmation record:

- Ollama documents System One support from version `0.35.0` onward in its [official JavaScript client README](https://github.com/ollama/ollama-js#system-one). The installed version is `0.40.5`. `d1:latest` is installed locally, and a local `POST http://localhost:11434/v1/systemone` request using `state` plus named `choice` and `noul` questions returned both named answers. The model library documents `ollama pull d1`; it lists `d1:3b` as a tag for the same model build. See the [d1 model page](https://ollama.com/library/d1) and [decision API guide](https://docs.ollama.com/capabilities/decision).
- The OpenAI guide specifies `POST /v1/decisions`, model `gpt-6-luna`, `input`, and a `questions` array. It uses bearer authentication. A `choice` answer has a selected `choice`, a `probabilities` array with `value` and `probability` entries, and may include `confidence`; a `predicate` answer has a `probability`. Answers may instead have `type: "refusal"`. See the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and [create decision API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

The excerpts below are documentation fixtures, not measured results. The Ollama examples use `nimble` and `clef-flash` because the official docs show those models' response bodies; they establish the answer formats supported by the shared endpoint. The separate local request above confirms that the installed `d1` build returns the named `choice` and `noul` answer forms.

Ollama choice excerpt:

```json
{
  "model": "nimble",
  "answers": {
    "label": {
      "type": "choice",
      "choice": "bug",
      "probabilities": { "billing": 0.0125, "bug": 0.9781, "account": 0.0093 }
    }
  }
}
```

Ollama `noul` excerpt:

```json
{
  "model": "clef-flash",
  "answers": {
    "has_ollama": { "type": "noul", "noul": 0.959 }
  }
}
```

OpenAI choice excerpt:

```json
{
  "answers": [
    {
      "type": "choice",
      "name": "department",
      "choice": "billing",
      "probabilities": [
        { "value": "billing", "probability": 0.95 },
        { "value": "technical", "probability": 0.02 },
        { "value": "shipping", "probability": 0.01 },
        { "value": "other", "probability": 0.02 }
      ],
      "confidence": 0.93
    }
  ]
}
```

OpenAI predicate excerpt:

```json
{
  "answers": [
    { "type": "predicate", "name": "visible_damage", "probability": 0.92 }
  ]
}
```

- [x] Confirm that the installed Ollama version supports local d1 and `POST /v1/systemone`. Record the required version from current documentation when available.
- [x] Confirm d1 installation and local serving steps using the [d1 model page](https://ollama.com/library/d1) and [Ollama decision documentation](https://docs.ollama.com/capabilities/decision). Use `d1` as the default model; document `d1:3b` if an explicit size tag is useful.
- [x] Verify the [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) and its linked API reference for `gpt-6-luna`, authentication, request fields, refusal responses, and probability fields.
- [x] Record small response fixtures from documented formats for both adapters, clearly marked as fixtures. Do not invent fields or claim these are measured model results.

Acceptance: official references and documentation fixtures record the endpoint, request fields, question types, answer fields, required Ollama version, model setup, and OpenAI model and authentication rules. The implementation must use those dedicated decision endpoints and report an unavailable endpoint or model without a chat or generated-JSON fallback.

## 2. Create the minimal Node.js project

Progress: The manifest and project-relative CLI entry points are in place. Node.js v24.22.0 is available. Both `node main.js` and `npm run eval` call the evaluation flow. Saved-result comparison is implemented in section 10 and passed the Task 14 review.

- [x] Add `package.json` with `private: true`, `type: "module"`, and a Node.js engine requirement of `>=24`.
- [x] Add `main.js` for evaluation and `compare.js` for saved-result comparison. Set `eval` to `node main.js`, `compare` to `node compare.js`, and `test` to `node --test`.
- [x] Use Node.js built-ins by default. If any dependency is necessary, explain its purpose and commit the resulting lockfile.
- [x] Resolve dataset and result paths relative to the project files so execution does not depend on the caller's current directory.

Acceptance: both `node main.js` and `npm run eval` invoke the same evaluation flow. No build step, TypeScript, frontend, database, Docker, or AWS deployment is required.

## 3. Add environment configuration and ignore rules

Progress: `config.js`, `.env.example`, and `.gitignore` are in place. Direct configuration checks passed, including `.env` loading, process environment precedence, Ollama defaults without an OpenAI key, and OpenAI key validation. Section 9's offline evaluation fixture passed. Saved-result comparison and its automated checks are implemented in sections 10 and 11. Task 14 independently verified actual environment-file loading and ignore behavior in a temporary copy.

- [x] Create `.env.example` with exactly the configuration keys and defaults shown in `AGENTS.md`, leaving `OPENAI_API_KEY` empty.
- [x] Load `.env` through Node.js built-ins before reading settings. Permit existing process environment values to take precedence. Explain how to copy `.env.example` to `.env`.
- [x] Validate `MODEL_PROVIDER` as `ollama` or `openai`, the selected model, the Ollama base URL when used, and the OpenAI key only for OpenAI requests. Report invalid settings clearly without disclosing secrets.
- [x] Make changing only `MODEL_PROVIDER` sufficient to switch adapters when both providers' settings are present.
- [x] Add `.gitignore` entries for private environment files, `node_modules/`, and generated `results/`; explicitly retain `.env.example`.

Acceptance: a local Ollama evaluation works without an OpenAI key. Comparison works without `.env`, credentials, or a running model. Real keys never appear in tracked files or result output.

## 4. Define shared decisions and input

Progress: `decisions.js` defines both questions, category options, attention criteria, and the `0.5` threshold in provider-neutral structures. The incident input builder uses only the incident ID and description. Provider contract and shared-input checks confirm that both adapter mappings preserve these definitions.

- [x] Add one shared definition for the category question, its ordered options, and its descriptions. Use these meanings consistently:

| Category | Meaning |
| --- | --- |
| `throttling` | Requests or work are limited by a rate, quota, throughput, or concurrency limit. |
| `authentication` | Identity, credentials, tokens, signatures, or access permissions prevent the operation. Include authorization failures in this category. |
| `dependency_failure` | A downstream service or dependency is unavailable, failing, or timing out, without stronger evidence for throttling or access failure as the cause. |
| `other` | The evidence points to another cause or does not support any of the categories above. |

- [x] Use the same category instructions for both models: select the best-supported primary cause from the evidence; prefer a specific rate-limit or access failure over a generic downstream symptom; use `other` when evidence is insufficient.
- [x] Define one attention question and shared true/false descriptions. Immediate attention means investigating now because evidence indicates ongoing or imminent material customer harm, such as blocked requests, sustained errors, or a growing processing backlog. A recovered isolated error, controlled test, or brief retry without material impact generally does not require immediate attention. Do not infer an outage from an error name alone.
- [x] Build one deterministic input string from each incident's ID and description, reused unchanged as Ollama `state` and OpenAI `input`. Exclude expected labels and evaluation commentary.
- [x] Give both questions stable names and use the same wording, option order, descriptions, and threshold for both adapters.

Acceptance: the shared module exposes both decisions with stable names, consistent wording, ordered category options, descriptions, attention criteria, and threshold. The input builder returns deterministic text from only each incident's ID and description. Adapter mapping checks in sections 6 and 7 will verify that shared meaning remains unchanged.

## 5. Create the synthetic incident dataset

Historical acceptance: the original 12-case summary dataset below was replaced by Task 16. The current contract is the versioned 120-case log dataset documented above.

Progress: `data/incidents.json` contains 12 synthetic incidents. Schema checks confirmed the record count, unique IDs, required services, allowed categories, boolean attention labels, and both attention outcomes in every category. Labels were reviewed against the shared definitions.

- [x] Add `data/incidents.json` containing exactly 12 incidents, each with `id`, `description`, `expectedCategory`, and `expectedRequiresAttention`.
- [x] Cover Lambda, DynamoDB, API Gateway, and Amazon SQS. Include the four categories and both attention outcomes, with urgency varying within categories.
- [x] Include straightforward cases with explicit evidence, such as Lambda concurrency exhaustion affecting customer requests, DynamoDB throughput limits, rejected API Gateway tokens, SQS permission errors, and downstream outages.
- [x] Include ambiguous cases such as a recovered retry, uncertain timeout cause, a testing-only alarm, and a backlog with unclear impact. Put all information needed for the expected decision in the description.
- [x] Review labels against the shared definitions before running either model. Validate unique nonempty IDs, useful descriptions, allowed category values, and actual boolean expectations.

Acceptance: the file has 12 valid, varied synthetic records. Expected outcomes remain fixed across provider runs and are never sent to the models.

## 6. Implement the Ollama adapter

Progress: The adapter uses `POST /v1/systemone`, the named `choice` and `noul` answers, and the shared decision definitions. Task 14 completed a live 12-incident evaluation. Its R1 timeout finding is now fixed: receiving headers and reading the body share transport error handling, while completed-body JSON parsing has its own error handling. Real local HTTP checks pass for timeouts before headers, stalled response bodies, and interrupted response bodies.

- [x] Use built-in `fetch` to call `POST {OLLAMA_BASE_URL}/v1/systemone` with JSON content type and the configured `OLLAMA_MODEL`.
- [x] Send the shared incident text as `state`. Build a named `questions` object with the category `choice` and its `criteria` map, and an attention `noul` with the shared instructions and true/false criteria.
- [x] Read answers by question name. Read the selected category and returned choice probability map; read attention probability from the `noul` answer.
- [x] Handle unreachable Ollama, request timeout, unknown model or unsupported endpoint, non-success HTTP status, invalid JSON, and invalid answer structure with a provider-specific error. R1 is resolved and covered by real HTTP timeout and disconnect checks in `test/provider-transport.test.js`.

Acceptance: contract checks verify the endpoint and payload, and a documented response fixture maps to the shared output without changing its probabilities. Timeouts before and after response headers arrive are reported as timeouts.

## 7. Implement the OpenAI adapter

Progress: The adapter and offline contract checks match the documented request and response shapes. Task 14 rechecked the official references and completed a live 12-incident evaluation. Its R1 timeout finding is now fixed: body-read timeouts retain the timeout message, interrupted bodies have a connection error, and completed malformed bodies retain the invalid-JSON message. Real local HTTP checks pass for each transport failure path.

- [x] Use built-in `fetch` to call `POST https://api.openai.com/v1/decisions` with bearer authentication, JSON content type, and the configured `OPENAI_MODEL`, defaulting to `gpt-6-luna`.
- [x] Send the same incident text as `input`. Build a `questions` array with a named category `choice` using `choices` values and descriptions, plus a named attention `predicate`.
- [x] Match returned answers by name. Convert choice probability entries to a map using each entry's value; read predicate `probability` directly.
- [x] Handle request timeout, connection failure, invalid credentials, access or rate-limit errors, refusal answers, non-success HTTP status, invalid JSON, and invalid answer structure without printing keys or authorization headers. R1 is resolved and covered by real HTTP timeout and disconnect checks in `test/provider-transport.test.js`.

Acceptance: contract checks verify the Decisions endpoint and payload. Fixture normalization preserves the supplied probability values and does not substitute `confidence`. Timeouts before and after response headers arrive are reported as timeouts.

## 8. Normalize and validate decisions

Progress: Both adapters now use shared normalization and validation in `decisions.js`. `README.md` records the invalid-response and unavailable-value policy. `npm test` passed all 20 checks, and `node --check` passed for `decisions.js` and both adapters. No provider API was contacted.

- [x] Return the same four fields from both adapters: `category`, `categoryProbabilities`, `requiresAttentionProbability`, and `requiresAttention`.
- [x] Validate returned categories and any supplied probabilities. Probabilities must be finite numbers in `[0, 1]`; do not coerce strings, repair invalid numbers, or change a distribution to make it sum to one.
- [x] Preserve the provider's selected category. Copy only the category probabilities actually returned; leave absent entries absent, and use `null` when the entire probability map is unavailable.
- [x] Set `requiresAttention` to `requiresAttentionProbability >= 0.5`. If attention probability is absent, use `null` for both attention fields and mark that decision unavailable. Never turn missing probability into zero or a negative decision.
- [x] Treat invalid supplied data, unknown categories, missing essential answers, and refusals as explicit incident errors or unavailable decisions. Describe the exact policy in the README and apply it equally to both adapters.

Acceptance: checks cover a probability of exactly `0.5`, values on either side, missing probability entries, and invalid responses. Saved numeric values retain the precision received from the provider.

## 9. Implement sequential evaluation and saved results

Task 16 update: validation, progress, scoring, and saved-result counts now follow the nonempty dataset size. Expanded offline runs cover 120 cases; the 12-case references below record original acceptance and historical live verification.

Progress: The runner validates all 12 dataset rows before requesting decisions, processes them sequentially, continues through per-incident errors, and saves provider-specific results with dataset and decision-definition identities. Offline fixtures verified ordered processing, full-precision values, returned model metadata, metrics, failure rows, unavailable decisions, secret redaction, and full-dataset denominators. Task 14 also verified both live providers and CLI failure exits while preserving all 12 rows.

- [x] Read and validate the dataset before making model requests. Select the adapter from configuration and process incidents sequentially in file order, with both questions in one request per incident.
- [x] Measure elapsed request time using a monotonic clock and store milliseconds. Include the first request in latency statistics; add no hidden warm-up, retries, or concurrent requests.
- [x] Display each incident ID, normalized decisions, available probabilities, expected outcomes, separate correctness for each question, and elapsed time. Clearly label missing values and errors.
- [x] Continue after an individual request failure and save an error row for that incident. Exit with a nonzero status when any request or required decision fails. Handle invalid dataset and file-write errors clearly.
- [x] Calculate category accuracy and attention accuracy as correct decisions divided by the full dataset count. Unavailable or failed decisions contribute no correct answer; report their counts separately. Calculate average latency across timed attempts and state that denominator, including failed timed requests.
- [x] Create `results/` as needed and write `results/ollama.json` or `results/openai.json`. Retain full-precision decisions, expectations, correctness, per-incident error or status, elapsed time, summaries, and completed/failed counts.
- [x] Save provider, requested and returned model identity when supplied, run time, dataset identity, decision-definition identity, threshold, and scoring version. Small hashes of the dataset and shared semantic definitions are enough to detect mismatched runs; no registry is needed.
- [x] Ensure every incident appears once and no secret configuration is saved. Keep display rounding separate from persisted numeric values.

Acceptance: an offline fixture run evaluates all 12 incidents sequentially, prints per-incident results and metrics, and writes the correct provider file. Failure rows remain visible in summaries and the exit status.

## 10. Implement saved-result comparison

- [x] Read `results/ollama.json` and `results/openai.json` without loading provider credentials or making network requests.
- [x] Validate saved files and report a missing file, invalid JSON, or incompatible schema by naming the affected path and the command needed to regenerate it.
- [x] Verify matching incident evidence and expectations, decision definitions, attention threshold, and scoring rules. Refuse to present mismatched runs as a fair comparison and explain which evaluations must be rerun.
- [x] Display a compact table with provider/model, category accuracy, attention accuracy, average latency in milliseconds, and success/failure counts. Label partial runs clearly.

Progress: `compare.js` reads and validates both saved result files without loading configuration or calling providers. It checks each result's schema, incident rows, status, decisions, scoring summary, and supported scoring rules. It refuses incompatible pairs with rerun instructions, labels partial rows, and returns a nonzero status for invalid, mismatched, or incomplete comparisons. Temporary acceptance fixtures passed for missing files, invalid JSON, unsupported schema, mismatched evidence and decision metadata, partial runs, and a valid pair. `node --check compare.js` passed. `npm run compare` reported both missing default files and their regeneration commands, then exited with status 1 as expected. No provider was contacted.

Acceptance: `npm run compare` handles missing, corrupt, partial, mismatched, and valid result pairs with clear output and an appropriate exit status.

## 11. Add focused offline checks

Progress: Automated checks cover provider configuration, shared input evidence, dataset invariants, sequential evaluation and scoring, secret redaction, saved-result paths, and offline comparison cases. Six added local HTTP checks exercise each adapter's real timeout signal before headers and during a stalled body, plus a disconnected response body. Four body-read checks failed before the fix and all six pass afterward. `npm test` passes all 39 checks, and syntax checks pass for 15 JavaScript files. Tests use fixtures, mocked requests, and local HTTP servers without provider calls.

- [x] Use `node:test` and `node:assert/strict`, with built-in HTTP mocking or a small local test server. Ensure no check requires credentials, Ollama, or external connectivity.
- [x] Check both adapter payloads and response mappings, including answer names, category descriptions, identical input evidence, exclusion of expected labels, probability preservation, and the `0.5` boundary.
- [x] Check invalid provider configuration, malformed JSON and response structures, missing probabilities, refusal answers, HTTP failures, connection failure, and timeout handling. Verify errors do not expose a dummy API key. Real abort-signal and interrupted-body checks for both adapters pass alongside the existing malformed-JSON cases.
- [x] Check dataset invariants, sequential request ordering, known metric arithmetic, error-row treatment, saved result paths, and the comparison cases in section 10.
- [x] Run syntax checks for the JavaScript files and `npm test`. Record actual results, including any checks that cannot run.

Acceptance: all local checks pass without external API calls, including real abort-signal checks after response headers arrive. Fixtures are kept separate from measured evaluation files.

## 12. Write the README and verify usage

Progress: The README covers setup, provider selection, decision examples, commands, result policies, troubleshooting, and official references. Task 14 passed all 33 original offline checks, syntax checks for 14 JavaScript files, clean-copy installation, actual `.env` loading and precedence, direct and npm CLI execution, failure exits, and ignore checks. Fresh sequential live evaluations completed all 12 incidents for each provider: Ollama scored 11/12 category and 12/12 attention with 292.8978 ms mean latency; OpenAI scored 12/12 on both questions with 229.21793333333335 ms mean latency. Both the existing saved pair and the fresh temporary pair passed comparison. The example key remains empty, generated results contain no configured key or authorization fields, and existing result files were preserved. The subsequent provider error diagnosis fixes in Tasks 6, 7, and 11 passed all 39 offline checks, syntax checks for 15 files, and saved-result comparison.

- [x] Explain the experiment, project scope, Node.js 24+ requirement, dependency installation with `npm install`, and `.env` setup.
- [x] Document installing an Ollama version that supports decisions, downloading with `ollama pull d1`, running the local server with `ollama serve` when it is not already running, and checking d1 through a decision request. Use decision examples when demonstrating model inference.
- [x] Explain setting `OPENAI_API_KEY` in the ignored `.env`, retaining `OPENAI_MODEL=gpt-6-luna`, and selecting the provider using only `MODEL_PROVIDER`.
- [x] Show direct execution with `node main.js`, evaluation with `npm run eval`, running each provider in turn, and offline comparison with `npm run compare`.
- [x] Describe saved files, the normalized output shape, the attention threshold, missing-value and failure policies, metric denominators, and latency units. State that local model loading and network conditions affect latency and that 12 synthetic incidents provide a limited experiment.
- [x] Include the official API references and troubleshooting for Ollama connection errors, unsupported decision endpoints, missing models, OpenAI access problems, malformed responses, and missing comparison files.
- [x] Run the documented offline setup and test commands in a clean environment where possible. Check that private environment files and generated results are ignored, and that the example key remains empty.
- [x] When available, perform a real local Ollama evaluation. The 12-incident evaluation completed successfully.
- [x] When OpenAI credentials are available, perform a real OpenAI evaluation and compare saved results. Completed during Task 14 with real requests, all 12 rows complete, and successful offline comparison of the temporary results.

Acceptance: a reader can install, configure, evaluate each provider, and compare results using the README. All credential-free checks have run, and any pending live verification is identified explicitly.
