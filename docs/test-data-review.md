# Current tests and dataset review

Task 18 follow-up (2026-10-19): the technical corrections and fresh provider runs are recorded in [Resolution and verification](#resolution-and-verification). The original v2 findings below are retained as the review record. Independent human annotation and production validation remain pending.

Reviewed on 2026-10-19 against `synthetic-aws-v2`, Node.js v24.22.0, and the current JavaScript sources. This supersedes the 12-case dataset assessment in [evaluation-review.md](evaluation-review.md) for current-data questions. Historical measurements remain historical.

The project is suitable for a small integration experiment. Its offline tests cover useful behavior, and the data has recognizable source-specific structures. The evidence does not establish a bias-free benchmark or production accuracy. Two format details need correction, scoring coverage has a demonstrated gap, and the current provider result files measure the old dataset.

Application code, incident JSON, evaluation notes, and saved provider results were preserved. Review changes are documentation only. No inference or AWS service API requests were made. Official documentation was read over the web; HTTP transport tests used local servers.

## Verification and strengths

| Check | Result |
| --- | --- |
| `npm test` | All 48 checks passed. |
| `node --check` for repository JavaScript | All 17 files passed. |
| Rebuild data in a temporary copy | Both JSON files matched the originals byte for byte. |
| Unique rows and IDs | 120 unique descriptions, scenario names, and opaque IDs. |
| Category coverage | 30 rows per category; every source/category cell has both attention outcomes. |
| Attention coverage | 60 true and 60 false; production has 58 true / 55 false, staging 2 true / 5 false. |
| Split bookkeeping | 92 development and 28 held-out cases, with no declared family assigned to both splits. |
| Shared input | Both adapters receive the same full evidence, including line breaks. Expected labels and evaluation-only notes are excluded. |
| Failure arithmetic | Failed or unavailable decisions stay in full-dataset denominators; unavailable attention remains null. |
| Transport | Local HTTP checks cover timeout before headers, timeout during a stalled body, and body disconnection for each adapter. |
| Historical saved comparison | `npm run compare` passed for two compatible 12-case files. Neither file matches the current dataset hash. |

The current dataset SHA-256 is `71544b0772bd7bb298ca424ac6e8f3ec0c56c830d81ceaa5a604013e5a15c8fc`.

The shared category policy handles authorization under `authentication`, gives specific rate/access causes precedence, and uses `other` for insufficient causal evidence. Attention depends on customer harm rather than category alone. A qualitative review found these definitions reasonable for the stated experiment. No systematic label inversion was found, but this was another agent review rather than independent human annotation.

## Findings

### R1. Wrong-category scoring can escape the entire test suite

Priority: P2. Locations: [evaluation.js](../evaluation.js), `accuracyLine` at line 241; [test/evaluation.test.js](../test/evaluation.test.js), sequential evaluation fixture; [test/shared-input.test.js](../test/shared-input.test.js), expanded mocked evaluation at line 76.

The evaluation fixtures return the expected category for every available category answer. They exercise a wrong attention answer, partial answers, and failed requests, but no successful wrong category answer with an independently asserted incorrect score.

Reproduction: a temporary copy changed only this expression in `accuracyLine`:

```js
// Original
category: row.decision === null ? null : row.decision.category === row.expected.category,

// Temporary mutation
category: row.decision === null ? null : true,
```

`node --test` still passed all 48 checks. The temporary mutation was never applied to this checkout. A separate one-case fixture against the original scorer returned category accuracy 0/1 when expected `throttling` received `other`, and 1/1 for a correct answer. This is a demonstrated test gap; the current category scorer itself behaved correctly.

Add an available wrong-category answer and assert row correctness, the saved row, summary numerator, and full denominator. Also verify that comparison accepts a legitimately incorrect row and rejects a falsified correctness flag or summary. The expanded mocked run remains useful for request ordering and serialization; its answers are constructed from expected labels, so its score supplies no model-quality evidence.

### R2. One MySQL excerpt contradicts its declared logging settings

Priority: P2. Locations: [docs/dataset.md](dataset.md), MySQL profile at line 45; [data/build-incidents.js](../data/build-incidents.js), `invalid-sql-test` at line 155 and `mysqlQuery` at line 197. Incident: `a6d810ec8d38f1be`.

The profile declares `log_raw=OFF`, but the general log includes `SELECT FROM orders`, followed by a caller `ER_PARSE_ERROR`. MySQL documents that password rewriting suppresses statements that cannot be parsed from the general query log unless raw logging is enabled. The selected configuration and this native record cannot both describe the documented behavior. See the [MySQL 8.0 general query log reference](https://dev.mysql.com/doc/refman/8.0/en/query-log.html).

The caller's message is also abbreviated to `You have an error in your SQL syntax`. The [MySQL 8.0 message catalog](https://raw.githubusercontent.com/mysql/mysql-server/8.0/share/messages_to_clients.txt) defines a longer English syntax message and a parse-error template that adds the offending fragment and line number. The documented wrapper selects the caught message without declaring abbreviation.

Keep this profile and omit the unparseable statement from its native excerpt, or define a separate raw-logging profile for the case. Make the caller message agree with a pinned engine/client example, or explicitly document message summarization. Add a regression fixture for the chosen configuration and event sequence. Update the generator and regenerate both JSON files together when fixing this.

### R3. Probability validation accepts impossible categorical totals

Priority: P2. Locations: [decisions.js](../decisions.js), probability loop at line 80; [compare.js](../compare.js), `validateDecision` at line 41. This finding from the historical review remains reproducible.

A complete map with all four categories set to 0.9 passes shared normalization, the evaluation runner, and saved-result validation. Its total is 3.6. Each individual number is checked, but neither a complete total nor the upper bound on a partial total is checked.

This does not alter today's category accuracy calculation, which uses the selected category. It permits invalid probability data to be saved as an ordinary decision and blocks reliable later probability scoring.

Flag invalid mass without changing provider values: a complete map should total one within a documented tolerance; a partial map cannot exceed one beyond that tolerance. Preserve missing entries and full precision. Test both validators, a legitimate partial map, and rounding tolerance. Do not require the selected category to equal the largest returned probability without verifying that requirement in the provider contract.

### R4. Coverage leaves predictable attention associations and an urgent-unknown gap

Priority: P2. Locations: [data/build-incidents.js](../data/build-incidents.js), scenario tables; [test/dataset.test.js](../test/dataset.test.js), coverage assertions at line 288.

Measured directly from the 120 JSON rows and their notes:

| Association | Current coverage |
| --- | --- |
| `unknown-timeout` family | Five false, zero true attention labels. |
| `conditional-write` family | Four false, zero true. |
| `input-validation` family | Seven false, zero true. |
| `missing-resource` family | Three true, zero false. |
| `schema-change` family | Three true, zero false. |
| All declared families | 19 of 30 have only one attention outcome, covering 56 cases. |
| Phrase `at 09:59` in model input | Present in 19 cases, all false. |

These associations are diagnostics from inspecting this dataset. They do not prove either model uses a shortcut. Recovery evidence is relevant to attention, and some narrow families naturally imply one outcome. The concern is missing counterexamples across broader mechanisms: an unknown cause with sustained harm should still require attention; a missing optional resource need not require attention; a duplicate or validation failure can coexist with customer harm.

Balanced category/source counts and overlapping text lengths do not test those cases. Add matched scenarios that keep the error mechanism while varying visible harm, recovery, and deadline evidence. Change timestamps independently of outcomes. Keep each related group in one split. Freeze expectations before inference and obtain an independent label review, recording ambiguity rather than automatically declaring every dispute resolved.

No demographic attributes or population groups are represented, so demographic fairness cannot be measured here. Provider preference, option-order sensitivity, wording sensitivity, and performance across unfamiliar log styles are also unmeasured.

### R5. Structural validators do not establish source semantics

Priority: P2. Locations: [test/dataset.test.js](../test/dataset.test.js), `client` at line 75 and MySQL validator at line 170.

The current `client` validator accepted a manufactured event with service `DynamoDB`, operation `DeleteMessage`, error `ProvisionedThroughputExceededException`, message `invented message`, and HTTP 500. The operation belongs to SQS, and DynamoDB documents this exception under HTTP 400. The check validates the service's error-name set and a generic 400-599 range without correlating service, operation, and status. See [DynamoDB error handling](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html) and the [SQS DeleteMessage operation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html).

This mutation does not assert that the shipped DynamoDB rows have those particular errors. It demonstrates that passing the validator cannot support the stronger claim that every field relationship matches AWS. R2 supplies a shipped case that already passes despite violating a logging setting. Most profile corruption checks alter a prefix; those checks should be supplemented with selected format-preserving semantic errors.

Use profile-specific valid operations and exception/status relationships for the operations represented. Check MySQL logging-setting consequences and message templates against a pinned engine patch/client. Avoid a universal UUID requirement for AWS response request IDs: the DynamoDB reference, for example, shows a longer service request ID. That example supports greater format variety, not a guaranteed universal request-ID schema.

### R6. Current model accuracy and held-out performance have not been measured

Priority: P2. Locations: [evaluation.js](../evaluation.js), `metricsFor` at line 182 and full-dataset loop; [compare.js](../compare.js), comparison display; [data/incident-notes.json](../data/incident-notes.json), split/review metadata.

Both result files contain 12 incidents with a hash different from v2. `npm run compare` correctly compares those two historical runs because they agree with each other. Its `COMPLETE` label means complete for their saved dataset, and does not establish a current 120-case measurement.

The 28 held-out cases have four authentication, eight dependency-failure, eleven other, and five throttling rows. The application does not load the notes or report split-specific scores. Evaluating all 120 rows is compatible with the CLI contract, but future prompt selection from that overall score would expose the reserved cases. Declared family separation is useful bookkeeping; public cases written by the same author are not blind independent evidence.

After data corrections and label review, regenerate both provider results with the frozen dataset and definitions. Keep the full-dataset result contract and derive development/held-out and per-family reports offline. Report attention false positives and false negatives, category confusion, and unavailable decisions alongside accuracy. Assess proper probability scores only on valid available probabilities, and record uncertainty and latency variation before claiming a provider advantage. A single fixed choice order shared by both providers is consistent input, but its effect on each model remains untested.

## AWS realism and intended use

| Evidence type | Assessment |
| --- | --- |
| Lambda | The warm text lifecycle, request correlation, tabbed application prefix, and report units agree with [AWS's Node.js examples](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html). Every one of the 20 cases uses the same 200.04 ms duration, memory values, and event timing. Cold starts, runtime crashes, timeouts, and stack traces are outside this profile. |
| API Gateway | Quoted access-template fields and default response-type/status combinations agree with the [AWS gateway response table](https://docs.aws.amazon.com/apigateway/latest/developerguide/supported-gateway-response-types.html). Each excerpt has the same health/error/health arrangement. Broader integrations and ambiguous causal paths need separate cases. |
| RDS PostgreSQL | The custom prefix and verbosity are plausible for the selected settings, with structured error/statement continuations and a deadlock example. [PostgreSQL logging settings](https://www.postgresql.org/docs/16/runtime-config-logging.html) support configuration-specific output. This review did not run PostgreSQL to reproduce every message. |
| RDS MySQL | Connect/query/quit records and separate caller outcomes are a useful design. R2 prevents strict fidelity acceptance for the current data. General query logs record received statements, not proof of query success. |
| DynamoDB and SQS | These are documented application wrappers over caller observations, rather than direct service log exports. That is a valid source choice, but it covers one invented application logging contract; R5 limits validation claims. |
| Operations context | Every case includes a manufactured worksheet with polished impact and recovery facts. Scores measure logs plus this supplied context. Raw-log triage, missing telemetry, stale observations, and conflicting sources remain unmeasured. |

The wrappers and worksheets are disclosed correctly. Some observations directly supply causal interpretation, such as a removed grant or a release referencing a missing column. If equivalent facts are unavailable to the eventual classifier, their presence makes this task easier than its intended use. More volume using the same renderer would not resolve that limitation.

Useful follow-up work is to correct R2/R3, close R1/R5 with small targeted checks, expand the counterexamples in R4, then collect independently authored synthetic cases with varied formats, incomplete evidence, and realistic time relationships. Keep the diagnostic balance explicit; the current 25% category shares and 50% urgent share are design choices, with no measured claim about production prevalence.

## Reproduction notes and limits

The mutation suite and deterministic rebuild ran in `C:/Users/lucaz/AppData/Local/Temp/aws-classifier-review-BCjnc0`; `mutation-output.txt` there records the mutation's passing suite. Only a temporary copy of `evaluation.js` was mutated. A separate temporary one-case evaluation established the original scorer's correct behavior and demonstrated invalid probability-map acceptance by both the runner and saved validator. Dataset association counts came from the two repository JSON files, joined by their verified order and IDs.

No statistical significance claim, production representativeness claim, live provider verification, or independent human annotation is supplied by this review. Review completion means the assessment is recorded; the proposed fixes remain open.

## Resolution and verification

Task 18 addressed the review against frozen dataset `synthetic-aws-v3`, SHA-256 `ecaa6833741951c8eeffc0c42dc7b1b5205dd29e620e8ae032f5397f2c222e1b`. Dataset labels and question definitions were fixed before the new provider outputs were examined. No labels or prompts were changed in response to these scores.

| Finding | Correction and evidence |
| --- | --- |
| R1 | A new fixture contains available wrong-category answers, partial answers, and invalid probabilities. It asserts row correctness, persisted rows, summary numerators and full denominators. Saved-result tests accept legitimate mistakes and reject falsified scoring. The former always-correct mutation now fails the new regression test. |
| R2 | Syntax-error general-log excerpts now omit unparseable SQL under `log_raw=OFF`; the caller retains the complete MySQL English parse message. Profiles pin MySQL 8.0.44 and mysql2 v3.14.0 message decoding. Tests reject an inserted malformed Query and an abbreviated error. |
| R3 | Both normalization and saved validation use one probability-map validator. Complete maps must total one within `1e-6`; partial maps may not exceed one beyond that tolerance. Tests cover excessive/insufficient mass, partial maps, rounding tolerance, adapter errors, and full-dataset failure treatment. Values are never rescaled or filled. |
| R4 | Nineteen matched scenarios add the missing harm/recovery outcomes. All 30 mechanism families now have both attention labels; counterparts retain their family and split. Unknown-cause sustained failures require attention. Timestamps and Lambda resource values vary independently of labels, and `at 09:59` occurs under both outcomes. Independent human labeling remains explicitly pending. |
| R5 | Caller tests correlate service, operation, exception and HTTP status, use service-specific selected ID shapes, and check native MySQL message templates and event lifecycle. Format-preserving mutations of operations, statuses, identifiers, error codes, messages and suppressed statements are rejected. This still establishes agreement with selected profiles, rather than authenticity of synthetic events. |
| R6 | Default comparison checks the pair against current evidence, definitions and threshold. A mutually compatible stale pair or forged row evidence is rejected. Explicit historical mode labels the skipped current-source checks. Matching evaluation-only notes produce split/family metrics, confusion counts, probability coverage and Brier scores, plus latency percentiles in `results/comparison.json`. Both providers completed fresh 139-case runs without failures. |

`npm test` passes all 58 offline checks under Node.js v24.22.0. Syntax checks cover 19 JavaScript files. A temporary rebuild reproduced both JSON files byte for byte. The scoring mutation was tested in `C:/Users/lucaz/AppData/Local/Temp/aws-classifier-verified-EsdusT`; its failure is recorded in `mutation-output.txt`. Old measured files were copied to `results/archive-before-v3-4B7fky` before regeneration. No provider framework or runtime dependency was added.

The new live runs each made 139 sequential decision requests, with two questions per request and the same incident evidence. There were no inference warm-ups, retries, or label changes after inference. A read-only Ollama model inventory check preceded evaluation.

| Provider | Category | Attention | Attention false alarms / misses | Mean latency |
| --- | --- | --- | --- | --- |
| Ollama d1 | 118/139 (84.9%) | 101/139 (72.7%) | 29 / 9 | 115.78 ms |
| OpenAI gpt-6-luna | 123/139 (88.5%) | 139/139 (100.0%) | 0 / 0 | 259.09 ms |

| Provider / split | Category | Attention |
| --- | --- | --- |
| Ollama development | 92/106 | 73/106 |
| Ollama held-out | 26/33 | 28/33 |
| OpenAI development | 93/106 | 106/106 |
| OpenAI held-out | 30/33 | 33/33 |

Full-precision values and all 139 rows remain in each provider file. Complete category maps and attention probabilities were available for every row. Offline category Brier scores are 0.219217 for Ollama and 0.157188 for OpenAI; attention Brier scores are 0.185362 and 0.001085. These scores describe this dataset and do not establish calibration on independent incidents. The pair present when Task 18 regenerated results contained 120 v2 cases per provider and was preserved in the archive. The 12-case files described in the original review above belonged to its earlier snapshot.

The current data has 139 cases representing 30 mechanism families, with shared authorship and supplied operational context. The review status in the notes remains `pending` for independent human annotation. No production data, option-order study, wording-sensitivity study, or repeated-latency experiment was added. Those limits prevent a claim of bias-free behavior, production accuracy, statistical significance, or a repeatable provider ranking. Future prompt work must use development evidence alone; inspecting the full-run score exposes the reserved cases.
