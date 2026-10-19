# Evaluation validity and bias review

Reviewed on 2026-10-17. Scope: the current CLI, its 12 synthetic incidents, tests, and existing saved evaluations. This review made no inference requests and changed no application code or saved provider results.

The CLI provides a useful integration experiment. Its current scores give little evidence about performance on unfamiliar incidents or value beyond simple rules. The largest observed problem is that the input contains incident IDs that reveal the expected decision.

## Existing evidence

Both saved result files pass `validateSavedResult` and `npm run compare`. Their dataset and decision-definition hashes also match the current source, checked independently during this review. The separate [task review](task-review.md) now records fresh live verification of both providers in a temporary copy. This review inspected the existing saved files and those temporary artifacts without repeating inference calls.

| Saved system | Category correct | Attention correct | Complete attempts | Mean request time |
| --- | --- | --- | --- | --- |
| Ollama / d1 | 11/12 | 12/12 | 12/12 | 63.17 ms |
| OpenAI / gpt-6-luna | 12/12 | 12/12 | 12/12 | 458.76 ms |

These are measurements reported by the saved artifacts, with times rounded only for display. A valid JSON file, model name, or matching hash cannot establish that an HTTP request occurred. The evaluator accepts an injected request function for offline testing, so fixtures can have the same saved schema. Future live verification should retain an explicit run record and allowlisted response metadata alongside the output.

Ollama's only category error is `api-gateway-isolated-unclear-timeout`: expected `other`, returned `dependency_failure`. Its probabilities are approximately 0.551 for dependency failure and 0.439 for other. This is one observed error involving insufficient causal evidence. It cannot establish a general tendency from one case.

## What the implementation does well

The adapters call the documented decision endpoints. [OpenAI](https://developers.openai.com/api/docs/guides/decisions) uses `/v1/decisions`, a questions array, `choice`, and `predicate`; [Ollama](https://docs.ollama.com/capabilities/decision) uses `/v1/systemone`, named questions, `choice`, and `noul`. The [d1 model page](https://ollama.com/library/d1) documents System One compatibility. This establishes agreement with the published contracts; offline fixtures cannot verify account access or live server behavior.

Shared definitions in [decisions.js](../decisions.js), lines 4 through 45, keep the categories and attention policy aligned. The adapters preserve that meaning while expressing attention criteria in their respective formats. Both questions are sent together, without using the category answer to decide urgency.

[buildIncidentInput](../decisions.js), line 105, selects only ID and description. Expected-label fields stay outside the request. [evaluation.js](../evaluation.js), line 270, processes incidents sequentially; its scoring at line 182 retains failures in the full-dataset denominator. Probability values are preserved, missing attention stays unavailable, and the inclusive 0.5 boundary is tested. [compare.js](../compare.js), line 259, checks matching evidence and expectations as well as definition hashes, threshold, and scoring rules.

These safeguards reduce unequal treatment between providers and misleading arithmetic. The input fields themselves still need scrutiny.

## Findings

### High priority: the incident ID is a decision shortcut

[decisions.js](../decisions.js), line 121, sends the ID to both providers. Names in [data/incidents.json](../data/incidents.json) include `concurrency-exhaustion`, `access-denied`, `recovered-timeout`, and `staging-load-test-alarm`. Several describe the diagnosis or recovery state before the model reads the description.

The following ID-only attention rule matches all 12 expected attention labels:

```js
const requiresAttention = !/(staging|recovered|fallback|isolated)/i.test(incident.id);
```

I constructed this rule after inspecting the dataset. Its 12/12 score demonstrates a shortcut in these examples; it does not estimate performance on unseen cases. No model calls were needed. It also does not establish that either model used the shortcut. An evaluation using opaque IDs for both providers would measure how much the ID affected their answers.

Expected-label exclusion tests currently check that field names are absent. They do not detect these semantic clues. Use opaque identifiers in a future benchmark, with the same identifiers and descriptions for both providers.

### High priority: the cases contain unusually clear conclusions

The descriptions often state the cause and outcome directly: a concurrency quota has been reached, valid JWTs are being rejected, or retries succeeded with no customer impact. They are short, edited summaries with little irrelevant evidence. The current program therefore tests classification of these summaries. It does not establish classification quality on raw AWS logs or on evidence available before a diagnosis.

The dataset has three examples per category and six examples per attention outcome. This gives useful fixture coverage. It does not represent a measured operational distribution. All three staging examples have negative attention labels, and very few cases require resolving uncertainty. Customer-impact claims are generally explicit.

A future study needs synthetic cases with incomplete observations, misleading symptoms, conflicting signals, benign production failures, and serious impact despite otherwise healthy metrics. Match the evidence to the moment when the intended decision would actually be made. If the intended input is a human-written incident summary, test unfamiliar summaries from several independent authors and compare against rules for that same input.

### High priority: no independent test set or practical baseline

The repository contains one visible set of 12 incidents. It records label review, but no separate development/test split or blind independent labeling procedure. I found no implemented majority or rule baseline. There is no evidence here that the models were tuned on these incidents, but repeated prompt changes against the same visible set would make its score unsuitable as an independent test.

A constant category scores 3/12, and either constant attention answer scores 6/12. Those are useful reference points. A rule classifier frozen before seeing a separate test set is the more relevant comparison for these explicit cause and impact cues. The ID-only diagnostic above was fitted after inspection and must stay separate from that baseline.

One category decision accounts for the entire observed difference between providers: 8.33 percentage points. With three cases per category, one miss changes that category's recall by 33.33 points. Twelve selected examples cannot support a reliable ranking or establish a low missed-incident rate.

### Medium priority: accuracy does not establish useful probabilities or an attention policy

[evaluation.js](../evaluation.js), line 182, reports accuracy and mean latency. It does not report attention false alarms and misses, category confusion, probability scoring, or calibration. Both saved systems have six attention true positives and six true negatives, with zero observed errors. This easy, balanced set leaves the difficult routing boundary largely untested.

Descriptive scores recomputed from the complete probability maps are:

| Saved system | Category Brier score | Attention Brier score |
| --- | --- | --- |
| Ollama / d1 | 0.090270 | 0.002024 |
| OpenAI / gpt-6-luna | 0.012900 | 0.000933 |

Category Brier here is the mean, across incidents, of the sum of four squared probability errors; attention Brier is the mean squared error for the true probability. Lower values are better. These numbers describe the saved examples and do not demonstrate calibration on new incidents. Probabilities of 0 or 1, both present in the OpenAI artifact, need difficult independent cases to assess their reliability.

The fixed 0.5 threshold gives both systems the same experiment policy. Its operational value remains unmeasured: the repository does not assign a cost to a missed urgent incident versus an unnecessary investigation, and "immediate" has no explicit response window. Keep 0.5 for the current comparison. Any later threshold study needs separate development data, a declared loss function, and versioned rules. The [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions) recommends selecting thresholds from labeled application examples and the costs of the two error types.

### Medium priority: invalid probability distributions can pass validation

[normalizeDecision](../decisions.js), line 80, and [saved-result validation](../compare.js), line 50, check each probability individually. They accept a complete map containing 0.9 for each of the four categories, even though the sum is 3.6. I reproduced acceptance by both validators using an in-memory object. The saved files were left untouched.

This did not cause the reported saved-run accuracy difference. It matters before calculating probability scores or calling a returned map a distribution. For a complete map, flag sums outside a documented numerical tolerance; preserve the original values and avoid renormalizing them. Keep partial maps explicitly partial, report their coverage, and do not fill absent categories to enable scoring.

### Medium priority: runtime and run-history evidence is limited

[evaluation.js](../evaluation.js), line 353, overwrites the same provider filename on each run. The result records requested and returned model names, but omits the local model digest, quantization, hardware, Ollama version, usage, and request identifiers. Mutable model aliases and adapter changes can alter behavior while the semantic-definition hash stays the same. There is no complete retained run history from which to assess variability or selection of results.

Mean latency includes all timed attempts and the first request, as required. That is a valid end-to-end measurement for these configured systems. Local model state and remote connection setup differ, and 12 requests provide little evidence about tail latency or throughput. These runs also change the model and execution environment together, so they cannot isolate an advantage caused by the Decisions endpoint itself. Keep claims about the two configured systems and this workload.

The separate Task 14 review supplies another pair of temporary artifacts. I checked their schemas and compatibility offline. They retain the same accuracy counts but report mean times of 292.90 ms for Ollama and 229.22 ms for OpenAI, reversing the latency ordering in the existing saved pair. The cause was not measured. This directly limits any speed ranking based on one run.

### Policy and bias limits

The category definitions deliberately put authorization failures under `authentication`, prefer supported access/rate-limit causes over downstream symptoms, and use `other` for both unknown and otherwise uncategorized causes. Those are visible task policies, applied to both providers. Scores measure agreement with that policy. They do not establish the actual root cause when the evidence cannot identify it.

The backlog case requires attention based on possible ongoing customer harm despite an unknown cause. A blind label review should check that interpretation and record reasons for disputed cases before provider output is examined. The data contains no demographic attributes or representative population groups, so this review cannot assess demographic fairness. The demonstrated concern is dataset shortcuts; wording, service, and option-order sensitivity remain unmeasured.

## Procedure for a more credible usefulness study

Keep the current 12 incidents as an integration fixture. The CLI enforces exactly 12 records in [evaluation.js](../evaluation.js), line 37. A larger benchmark would require a later scope change; this review does not expand that contract.

1. Define the intended input and decision time. Specify what counts as material customer harm, the response window, how unknown impact is treated, and the acceptable missed-incident and false-alarm costs. Write success criteria before evaluating new cases.
2. Have independent reviewers label unfamiliar synthetic evidence using the frozen definitions, without seeing provider answers. Record rationales and resolve disputes. Include realistic prevalence scenarios separately from deliberately balanced diagnostic sets.
3. Separate development and final test cases by incident family. Keep near-duplicate variants together. Freeze both providers' question meaning, the baseline rules, threshold, and scoring before revealing the final set. Treat the current visible incidents as development material.
4. Compare both models with constant and deterministic rule baselines on the same evidence. Report incremental correct decisions, urgent misses, unnecessary investigations, and request failures. A useful model should improve the declared cost or review workload enough to justify its operating expense and delay.
5. Run explicitly declared sensitivity studies with opaque IDs, reordered choices, paraphrases, and irrelevant log content. Change one factor at a time, use equivalent variants for both providers, and keep each variant's results separate. No hidden provider-specific input changes.
6. Preserve sequential dataset order within every run. Declare repetitions and provider run order beforehand; retain every run, including failures. Record first-request timing and observed cache/model state, without hidden warm-up calls or retries.
7. Retain run-specific artifacts with dataset, definition, and adapter/source identities. Record local model build information and allowlisted provider metadata when available. Reconcile returned models and per-question outcomes. Never save keys, authorization headers, or environment dumps.
8. Report full-dataset accuracy alongside per-class confusion, attention precision/recall, unavailable-answer coverage, proper probability scores where available, request-time distributions, and cost per attempted and usable decision. Assess uncertainty over independent incident families; repeated requests to the same 12 cases do not increase case diversity. Keep conditional successful-answer metrics labeled separately from the full-dataset metrics.

This procedure follows the task-specific data and human-review principles in [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices). It proposes future work within the existing synthetic-data boundary. It does not establish production performance without evidence representative of the eventual use.

## Verification record

- `npm test`: all 33 tests passed under Node.js v24.22.0. The suite uses mocked requests and temporary fixtures.
- `node --check`: passed for all 14 JavaScript files. All local source links in this report resolve.
- `npm run compare`: passed for both existing saved files, with all 12 rows complete per provider.
- Independently recomputed dataset/definition hashes, correctness, attention confusion counts, and the descriptive probability scores reported above.
- Reproduced the 12/12 ID-only attention shortcut and invalid-distribution acceptance by both validators, without provider calls or result-file edits.

The separate Task 14 report records live integration checks. This review made no inference requests and cannot independently attest to the origin of the earlier saved pair. Independent-case accuracy, calibration, and operational utility remain unverified; the two artifact pairs also show that a repeatable latency ordering has not been established.
