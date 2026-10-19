# Synthetic incident dataset v3

Task 16 format contract, defined before authoring on 2026-10-19. All events, identifiers, SQL, resources, addresses, and measurements are manufactured. These are synthetic examples of the declared formats, never captures from AWS. Native formats and application fields have different origins.

Task 18 corrects the [current review](test-data-review.md) findings in `synthetic-aws-v3`: unparseable SQL is omitted under `log_raw=OFF`, native MySQL client messages follow a pinned catalog, caller validation correlates service/operation/error/status, and 19 matched scenarios add the missing attention outcomes. Original opaque IDs remain stable. Native event timing and Lambda memory/duration values vary by an outcome-independent key digest.

`data/incidents.json` is the measured input. Each row has an opaque ID, multiline `description`, and the two existing expected-label fields. `data/incident-notes.json` is evaluation-only: version, source/profile associations, scenario families, split, difficulty, label review, and evidence rationales. Neither notes nor expected labels enter `buildIncidentInput`. No provider answers are used to set expectations.

## Capture and source boundaries

Descriptions use `[source: NAME | view: VIEW]` headings. Headings are editorial boundaries, never native log records. The next heading ends that source. Native text is preserved, including tabs; JSON messages occupy one physical line. CloudWatch-backed sections show message strings extracted in event order from `GetLogEvents`, with each event's terminating newline retained as a line boundary. They omit the surrounding API envelope, pagination tokens, `timestamp`, and `ingestionTime`; none of that metadata is inserted into a native message. See the official [GetLogEvents response](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_GetLogEvents.html). Database sections are raw downloaded file excerpts, excluding startup headers and rotation boundaries. They aren't console tables or CSV exports.

Every description also has a separate `operations` section. Its timestamped observations are application-defined decision-time records from a synthetic operations worksheet, not CloudWatch metrics output. They identify environment, observation window, workflow, counts, deadlines, and recovery/fallback evidence as available. Some supply causal context such as a policy change; performance therefore measures logs plus that supplied context. Missing/stale worksheet facts and raw-log-only triage are outside the current claim. No observations later than the cutoff are allowed.

## Profiles

### lambda-node22-text

AWS Lambda managed `nodejs22.x`, text log format, warm invocations, tracing disabled. Application code calls `console.info(JSON.stringify(event))` or `console.error(JSON.stringify(event))`, with a single string argument. Runtime prefixes are ISO UTC timestamp, invocation UUID, and level separated by tabs. The payload fields are defined by the application, including caught errors, HTTP responses, and operation names. Caught failures do not cause a runtime crash. Each complete invocation has `START`, application events, `END`, and `REPORT`. The report uses milliseconds and MB; billed duration is the rounded-up handler duration for these warm invocations. There is no `Init Duration`, X-Ray, or runtime error/status field in this profile. Caller-side Invoke rejection is logged by a different executing function; no invocation records are fabricated for a rejected target invocation.

Reference: [Node.js Lambda text and report examples](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html). Representative review checks the prefix, invocation ID continuity, platform/application separation, and conditional fields. Duration, memory, and timestamps vary by a key digest independently of labels. Tests check application timestamps within handler duration and used memory within allocation. This profile doesn't cover cold starts, uncaught exceptions, runtime timeouts, Java, or Lambda JSON logging.

### node24-client-json

Node.js 24 application, AWS SDK for JavaScript v3 for DynamoDB/SQS/Lambda calls, or a MySQL client for database calls. A small application wrapper writes one JSON object per line directly to stdout; it does not enable the SDK's default console logger. Required fields: `time`, `level`, `service`, `operation`, and `event`. AWS error events select `name`, `message`, and, when supplied, `httpStatusCode` and `requestId` from the caught exception/`$metadata`. The MySQL wrapper maps the driver's symbolic `code` to the application field `name`; it does not claim that the JavaScript Error object's name is an engine error code. Its `connectionId`, when present, is the driver's established session/thread ID. Network failures have no service request ID or HTTP status. Successful calls can include `httpStatusCode`/`requestId`; application events can add workflow data. All field names and serialization here are application-defined. This is caller output, never DynamoDB or SQS service-generated logging. One final SDK outcome per recorded call is shown; any application retry is a separate event. No assumption about the SDK's internal default retries is made.

The wrapper's serialization contract is `process.stdout.write(JSON.stringify({time: new Date().toISOString(), level, service, operation, event, ...selectedFields}) + "\n")`. It excludes request payloads, tokens, headers, and full error objects. References: [SDK logging and middleware](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/logging-sdk-calls.html), [DynamoDB errors](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html), [SQS SendMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html), [ReceiveMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html), and [DeleteMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html). Tests correlate the selected service, operation, exception and HTTP status, reject response metadata on local failures, and check MySQL error templates. The selected manufactured DynamoDB IDs use 52 uppercase alphanumeric characters; SQS uses UUIDs. These are profile choices based on documented examples, not a universal AWS identifier restriction.

### apigw-rest-json

API Gateway REST API v1, access logging enabled on the stage. Execution logging is disabled and no execution trace is simulated. The access template is exactly:

```text
{"requestId":"$context.requestId","extendedRequestId":"$context.extendedRequestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength","responseType":"$context.error.responseType"}
```

All substitutions are quoted strings. Missing error response types render as `-`. Requests reaching the integration may return application 4xx/5xx with `responseType` still `-`; an HTTP status alone does not prove the cause. No integration status or authorizer latency is invented. HTTP integrations in these cases use HTTP/1.1. Source addresses come from the documentation-only ranges. References: [access-log templates](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-access-logging.html), [access-log variables](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-variables-for-access-logging.html), and [gateway response types](https://docs.aws.amazon.com/apigateway/latest/developerguide/supported-gateway-response-types.html). Review checks request time syntax, UUID versus extended ID, string-valued status/length, and response-type/status combinations. Supplemental client observations have their own source boundary.

### rds-pg16-stderr

RDS PostgreSQL 16, downloaded stderr log, `log_destination=stderr`, `log_timezone=UTC`, custom `log_line_prefix='%m [%p] %u@%d '`, `log_error_verbosity=default`, `log_min_messages=warning`, `log_min_error_statement=error`, and `log_min_duration_statement=0` for completed statements. The prefix contains millisecond UTC time, PID, user, and database. Only client sessions are excerpted. `DETAIL`, `HINT`, and `STATEMENT` records retain the same prefix/session when present. SQLSTATE and source-code `LOCATION` are absent under this verbosity/prefix. Failed statements may be followed by `STATEMENT`; fatal connection rejections have no query record. A terminated PID isn't reused for later activity within an excerpt.

References: [RDS logging settings](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.Concepts.PostgreSQL.overview.parameter-groups.html), [PostgreSQL 16 prefix and verbosity](https://www.postgresql.org/docs/16/runtime-config-logging.html), [16 error codes](https://www.postgresql.org/docs/16/errcodes-appendix.html), and upstream [connection initialization messages](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/utils/init/postinit.c) / [authentication messages](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/libpq/auth.c). Review checks known engine messages, session continuity, and continuation fields against the selected configuration. Application impact remains in `operations`, not database log lines.

### rds-mysql80-general

RDS MySQL 8.0.44, native general query FILE log, `general_log=1`, `log_output=FILE`, `log_timestamps=UTC`, `log_raw=OFF`, and `innodb_lock_wait_timeout=1` second in the lock-wait case. Excerpts omit file headers. Each record uses an ISO UTC microsecond timestamp, tab, five-character right-aligned thread ID, space, command, tab, argument. Successful `Connect` records include user, host, database, and `using SSL/TLS`; `Query` records contain received parseable SQL; `Quit` has an empty argument. Unparseable statements are suppressed by password rewriting under `log_raw=OFF`: syntax-error cases show Connect/Quit and a separate caller error, with no Query record. The general log records receipt without proving query success or elapsed duration. Errors and outcomes come from a separately labeled caller JSON section. Observer replica sessions and failed writer connections remain distinct.

References: [RDS MySQL settings](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_LogAccess.MySQL.LogFileSize.html), [general log](https://dev.mysql.com/doc/refman/8.0/en/query-log.html), upstream [8.0.44 formatter](https://github.com/mysql/mysql-server/blob/mysql-8.0.44/sql/log.cc), [8.0.44 English error catalog](https://github.com/mysql/mysql-server/blob/mysql-8.0.44/share/messages_to_clients.txt), and [mysql2 v3.14.0 error decoding](https://github.com/sidorares/node-mysql2/blob/v3.14.0/lib/packets/packet.js). The synthetic wrapper selects the driver's `code` as `name`, `sqlMessage` as `message`, and established thread ID as `connectionId`; it does not abbreviate messages. Tests check the selected templates, parser-error suppression, thread correlation, lock-wait timing, and caller-before-Quit order. These fixtures do not establish execution on a live engine. Error/slow-query logs are outside this profile.

### operations-v1

Application-defined worksheet rendering: `ISO_UTC | key=value; ...` followed by timestamped free-text observations. This profile has no AWS-native claim or required AWS configuration. Times denote observation times, not hypothetical future recovery. Tests check parseable times, ordering, decision cutoff, and a stated environment/window. See each case's rationale for which observation supports customer impact.

## Label review and reserved cases

The frozen definitions are in `decisions.js`. Specific supported rate/access failures take precedence over generic downstream symptoms. Unknown cause, application defects, bad inputs, and lock contention fall under `other`. Attention depends on evidence of material harm at the cutoff, including a growing backlog approaching a customer deadline. Healthy aggregate metrics can hide an affected cohort; a production error can be harmless after recovery or with a verified fallback.

Each case records cause and impact reasons, reviewed against the frozen definitions before v3 inference. `independentReview.status` remains `pending` with no named human reviewer; an agent policy pass cannot replace independent human annotation. Ambiguous causes use `other` unless visible evidence supports a listed cause. Each counterpart records its source scenario and stays in the same mechanism family and split. Every family now has both attention outcomes. Related variants increase stress coverage without increasing the count of independent mechanisms. Public cases and shared authorship do not establish a blind benchmark. No prompt or adapter question semantics changed for Task 18.

## Coverage and verification

Coverage is a diagnostic design, not an estimate of production prevalence. A source name, environment, error keyword, or description length cannot by itself identify the labels: each source has every category and both attention outcomes, both environments include both outcomes, error forms occur with both outcomes, and text lengths overlap. This does not establish the absence of subtler shortcuts. Check byte-for-byte shared input for every case and keep the entire text, including source order and line breaks.

The 139 cases contain 36 throttling, 31 authentication, 34 dependency-failure, and 38 other labels, with 73 attention false and 66 true. Each category/source cell below shows `attention false / true`. Difficulty means direct causal evidence, mixed evidence requiring recovery/cohort/precedence reasoning, or uncertain observations requiring bounded conclusions. Difficulty labels are reviewer judgments, not measured model difficulty. The original 120 distinct scenarios are retained with 19 explicit matched counterparts.

| Primary source | Throttling | Authentication | Dependency failure | Other | Direct | Mixed | Uncertain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lambda | 3 / 4 | 3 / 2 | 3 / 3 | 3 / 3 | 7 | 14 | 3 |
| DynamoDB caller | 3 / 3 | 4 / 2 | 2 / 4 | 4 / 3 | 7 | 15 | 3 |
| SQS caller | 5 / 3 | 3 / 2 | 3 / 3 | 4 / 3 | 7 | 16 | 3 |
| API Gateway | 2 / 3 | 3 / 2 | 2 / 3 | 3 / 2 | 6 | 11 | 3 |
| RDS PostgreSQL | 2 / 3 | 3 / 2 | 3 / 3 | 5 / 2 | 7 | 13 | 3 |
| RDS MySQL plus caller | 2 / 3 | 3 / 2 | 2 / 3 | 3 / 3 | 7 | 11 | 3 |

Production has 131 cases (68 false, 63 true); staging has eight (five false, three true). Staging attention cases show paid work routed to those resources, with observed delay. There are 30 mechanism families: 106 development cases and 33 held-out cases. Held-out families remain hourly quota, signatures, connection resets, schema changes, hot partitions, KMS quota, missing resources, and unknown timeouts. Their counterparts remain held out. Split membership is frozen before inference. Future prompt work must use development cases alone; the full-run score includes held-out evidence and must not drive prompt selection. `npm run compare` derives split and per-family metrics offline from hash-matched notes.

Representative format review on 2026-10-19 used the official references in each profile above and the following actual dataset excerpts. The review checks format agreement with those references, not event authenticity. Every excerpt also passes its profile validator.

| Profile | Representative opaque ID | Reviewed details |
| --- | --- | --- |
| lambda-node22-text | `00822703fc36b081` | START/END/REPORT match; tabbed application prefix; no child invocation fabricated after Invoke rejection; warm report omits init and tracing fields. |
| node24-client-json | `6f338020539d7ece` | SQS caller exception, application-defined field names, separate HTTP metadata, no message body or credentials. Network fixtures omit service response metadata. |
| apigw-rest-json | `ca55263222882fbe` | Exact quoted template fields; QUOTA_EXCEEDED with 429; surrounding health-route requests have absent response type rendered as `-` and don't imply the affected workflow succeeded. |
| rds-pg16-stderr | `495d0163e64fa7c6` | Custom prefix, session PID/user/database, ERROR then same-session STATEMENT, no SQLSTATE under default verbosity. Duplicate-key and deadlock cases separately check DETAIL/HINT and tabbed continuation lines. |
| rds-mysql80-general | `674f0c4f53fcedb3` | UTC microseconds, padded thread, Connect/Query/Quit, observer replica separate from writer's failed login caller. Worker query cases check caller-thread correlation and lock-wait elapsed time. |
| operations-v1 | `6f338020539d7ece` | Worksheet boundary, explicit environment/window, observation timestamps at or before cutoff, workload counts supporting the expected impact. This is an application-owned format. |

Format tests use small independently written reference-shaped fixtures and corruption checks as well as every dataset excerpt. Passing structural checks and a source review cannot prove AWS emitted a manufactured event. No live provider verification is part of dataset construction. Expanded mocked evaluations are temporary test fixtures, never measured results.

`node data/build-incidents.js` regenerates data and notes together. `npm test` checks their identity and exercises both adapters on all 139 inputs with mocked HTTP, exact evidence and one call per incident. Separate arithmetic checks use variable sizes and wrong/partial/failed decisions. Semantic corruption fixtures check HTTP status, operation, request ID, MySQL messages, and logging settings. Current comparison rejects a mutually compatible stale pair as well as forged row evidence. Category mass is validated within `1e-6` without modifying values. Both JSON files rebuild byte for byte in a temporary copy, and the former category-scoring mutation is rejected by the regression test. Actual v3 provider measurements are recorded separately in Task 18.
