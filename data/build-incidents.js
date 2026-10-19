// Offline authoring only. See docs/dataset.md for formats, review, and limitations.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const cases = [];
const categories = { T: "throttling", A: "authentication", D: "dependency_failure", O: "other" };
const heldOutFamilies = new Set([
  "hourly-quota", "signature", "network-reset", "schema-change", "hot-partition", "kms-quota", "missing-resource", "unknown-timeout",
]);

// key | family | category | attention | difficulty | operation | error | HTTP status | message | observations
function add(source, text) {
  for (const line of text.trim().split("\n")) {
    const fields = line.trim().split("|");
    if (fields.length !== 10) throw new Error(`Invalid authoring row: ${line}`);
    const [key, family, category, attention, difficulty, operation, name, status, message, observations] = fields;
    cases.push({ source, key, family, category: categories[category], attention: attention === "1",
      difficulty, operation, name, status: status === "-" ? null : Number(status), message, observations });
  }
}

add("Lambda", `
child-concurrency|concurrency|T|1|direct|Invoke|TooManyRequestsException|429|ConcurrentInvocationLimitExceeded|workflow=checkout; child reserved concurrency=4; rejected invocations=381 in last 10m; completed checkouts=19/400; newest request also rejected
batch-burst|burst|T|0|mixed|Invoke|TooManyRequestsException|429|ReservedFunctionConcurrentInvocationLimitExceeded|workflow=nightly-catalog; batch burst rejected 2 calls; application retried both successfully at 09:59; pending jobs=0; product reads=3000/3000
region-shared-cap|account-cap|T|1|mixed|Invoke|TooManyRequestsException|429|ConcurrentInvocationLimitExceeded|environment=staging; workflow=shipping-labels; production dispatcher now sends paid shipping work to this stage; function reserved concurrency unset; regional concurrent executions=1000/1000; labels waiting=922; oldest wait=17m; dispatch deadline in 4m
probe-rate|rate-probe|T|0|direct|Invoke|TooManyRequestsException|429|ReservedFunctionConcurrentInvocationLimitExceeded|environment=staging; workflow=capacity-probe; test completed; synthetic invocations only; production dispatch=810/810; pending production jobs=0
async-consumer-cap|consumer-cap|T|1|mixed|Invoke|TooManyRequestsException|429|ReservedFunctionConcurrentInvocationLimitExceeded|workflow=receipt-delivery; accepted API responses=2200/2200; child invocations rejected=870 in 8m; receipt queue age=26m and rising; promised delivery=10m
retired-role-probe|policy|A|0|direct|Invoke|AccessDeniedException|403|Caller is not authorized to perform lambda:InvokeFunction|workflow=role-policy-check; old role test rejected; active role completed 150/150 child calls; no queued customer work
alias-permission|policy|A|1|direct|Invoke|AccessDeniedException|403|Caller is not authorized to perform lambda:InvokeFunction|workflow=order-routing; new alias denies active execution role; rejected calls=460/460 in 6m; unassigned paid orders=460
rotated-session|credentials|A|0|mixed|Invoke|ExpiredTokenException|403|The security token included in the request is expired|workflow=inventory-refresh; stale assumed-role session rejected once; refreshed session completed the same job at 09:59; pending refreshes=0; stock reads within 1m target
signed-region|signature|A|1|mixed|Invoke|InvalidSignatureException|403|Signature expired|workflow=account-activation; signed calls rejected=290/300 in 9m; clock offset on signer=11m; activation confirmations pending=290
unused-target-role|policy|A|0|uncertain|Invoke|AccessDeniedException|403|Caller is not authorized to perform lambda:InvokeFunction|workflow=report-preview; preview feature disabled for customers; single deployment smoke check rejected; scheduled statements delivered=600/600
inventory-upstream|upstream-http|D|1|direct|GET /inventory|HttpError|503|Service Unavailable|workflow=cart-reservation; inventory health checks=0/20; reservation failures=389/400 in 10m; latest reservation failed; no cache path configured
address-retry|remote-timeout|D|0|mixed|POST /address|TimeoutError|-|Address service deadline exceeded|workflow=address-validation; initial call timed out; retry succeeded at 09:59; shipping requests=500/500; repeated timeouts=0 in last 5m
reset-upload|network-reset|D|1|mixed|POST /render|ECONNRESET|-|socket hang up|workflow=document-generation; render connections reset on 87/90 attempts in 7m; paid documents waiting=87; download availability=3/90
tax-cache|fallback|D|0|mixed|GET /tax|HttpError|503|Service Unavailable|workflow=checkout-tax; live tax fetches failed=18; versioned fallback calculations passed reconciliation for all 18; purchases=980/980; fallback valid for next 2h
dns-partner|dns|D|1|uncertain|GET /fraud|ENOTFOUND|-|getaddrinfo ENOTFOUND fraud.example.invalid|workflow=payment-review; partner DNS lookup failed on 63 consecutive requests over 6m; paid orders waiting=63; review deadline in 3m
bad-payload|input-validation|O|0|direct|decode-event|SyntaxError|-|Unexpected end of JSON input|workflow=event-import; one malformed synthetic probe quarantined; customer events processed=740/740; retry queue empty
schema-deploy|schema-change|O|1|direct|map-record|TypeError|-|Cannot read properties of undefined (reading 'sku')|workflow=order-ingest; new payload schema received; transform errors=718/730 since release 12m ago; paid orders pending=718
timeout-unclear|unknown-timeout|O|0|uncertain|handler-budget|Observation|-|deadline reached without a dependency span|workflow=recommendations; one request returned 504; no further failures in 10m; trace sampling dropped the failed span; subsequent requests=2300/2300
loop-defect|application-defect|O|1|mixed|normalize-batch|RangeError|-|Maximum call stack size exceeded|workflow=settlement-export; recursion error for every batch=34/34 in 11m; settlement deadline in 5m; no export file written
normal-error-word|benign-signal|O|0|mixed|validate-fixture|ValidationResult|-|fixture named AccessDeniedException matched its expected text|workflow=parser-self-test; local string assertion passed; no AWS call attempted; customer jobs=190/190; pending jobs=0
`);

add("DynamoDB", `
gsi-hot-key|hot-partition|T|1|direct|Query|ProvisionedThroughputExceededException|400|The level of configured provisioned throughput for the index was exceeded|workflow=product-search; GSI consumed read units=100/100; throttled index reads=1880 in 10m; search requests failed=720/1000
write-retry|burst|T|0|mixed|PutItem|ProvisionedThroughputExceededException|400|The level of configured provisioned throughput for the table was exceeded|workflow=bookmark-save; one write rejected; application retry committed at 09:59; write acknowledgements=401/401; duplicate records=0
on-demand-account|account-cap|T|1|mixed|GetItem|RequestLimitExceeded|400|Throughput exceeds the current throughput quota for your account|workflow=entitlement-read; table on-demand mode; reads rejected=662/700 in 8m; active paid sessions denied access=662
scheduled-export|account-cap|T|0|direct|Scan|RequestLimitExceeded|400|Throughput exceeds the current throughput quota for your account|workflow=analytics-export; export paused under account quota; next required delivery tomorrow; interactive reads=900/900; export deadline slack=18h
write-cap-cohort|consumer-cap|T|1|mixed|UpdateItem|ThrottlingException|400|Throughput exceeds the current capacity of your table or index|workflow=seat-allocation; aggregate success=99.5%; affected event partition rejected 117/120 writes; 117 paid reservations expire in 3m
expired-dev-session|credentials|A|0|direct|DescribeTable|ExpiredTokenException|400|The security token included in the request is expired|environment=staging; workflow=schema-inspection; interactive developer session expired; no customer workload on this role; production table reads=1100/1100
revoked-table-policy|policy|A|1|direct|GetItem|AccessDeniedException|400|Caller is not authorized to perform dynamodb:GetItem|workflow=subscription-check; role policy changed at 09:51; access failures=502/510; affected customers cannot open paid content
sig-refresh|signature|A|0|mixed|Query|IncompleteSignatureException|400|The request signature does not conform to AWS standards|workflow=stock-audit; one malformed signer request; replacement signer completed audit at 09:59; checkout stock reads=820/820
kms-key-denial|kms-access|A|1|mixed|PutItem|AccessDeniedException|400|Access to the encryption key was denied|workflow=transaction-journal; KMS key policy updated; journal writes denied=230/230 over 7m; posting waits for durable journal commit
retired-table-canary|policy|A|0|uncertain|Scan|AccessDeniedException|400|Caller is not authorized to perform dynamodb:Scan|workflow=legacy-table-canary; read denied on retired table; current table served all 1400 requests; old canary excluded from customer path
service-internal|upstream-http|D|1|direct|TransactWriteItems|InternalServerError|500|The server encountered an internal error trying to fulfill the request|workflow=wallet-transfer; 50 consecutive transaction requests returned 500 in 6m; transfers awaiting commit=50; no success after 09:54
read-fallback|fallback|D|0|mixed|GetItem|InternalServerError|500|The server encountered an internal error trying to fulfill the request|workflow=public-catalog; 8 reads failed; immutable catalog snapshot served all 8 with matching version; product page success=2300/2300
connection-reset|network-reset|D|1|mixed|BatchWriteItem|ECONNRESET|-|read ECONNRESET|workflow=invoice-index; 39 batches lost connection before acknowledgement; reconciliation finds 390 invoices absent; backlog age rose from 2m to 21m
dns-recovered|dns|D|0|mixed|GetItem|ENOTFOUND|-|getaddrinfo ENOTFOUND dynamodb.us-east-1.amazonaws.com|workflow=feature-read; one resolver failure; alternate resolver returned records at 09:59; customer requests=920/920 using last valid flags
connect-timeout|remote-timeout|D|1|uncertain|UpdateItem|TimeoutError|-|Socket timed out without establishing a connection|workflow=loyalty-redemption; 94 consecutive connection attempts expired over 12m; redemptions waiting=94; no later acknowledgement visible
condition-race|conditional-write|O|0|direct|PutItem|ConditionalCheckFailedException|400|The conditional request failed|workflow=idempotent-receipts; duplicate event rejected by condition; original receipt already committed; unique receipts=800/800; duplicate charges=0
wrong-table|missing-resource|O|1|direct|GetItem|ResourceNotFoundException|400|Requested resource not found|workflow=pricing; deployment table name points to removed resource; price lookup errors=831/850 in 9m; purchases blocked=831
malformed-probe|input-validation|O|0|mixed|Query|ValidationException|400|Query condition missed key schema element: pk|workflow=query-builder-test; generated malformed request rejected in isolated test table; production search success=600/600; no unprocessed work
marshal-defect|application-defect|O|1|mixed|marshall|TypeError|-|Cannot convert undefined or null to object|workflow=order-persist; local serialization failed before SDK send=420/420; durable orders written=0; payment captures awaiting orders=420
ambiguous-budget|unknown-timeout|O|0|uncertain|request-budget|Observation|-|Request deadline elapsed; SDK completion was not captured|workflow=dashboard-refresh; one client deadline; server trace missing; next 600 refreshes succeeded; no repeated delays in 10m
`);

add("SQS", `
fifo-send-rate|fifo-rate|T|1|direct|SendMessage|RequestThrottled|400|The request was denied due to request throttling|workflow=dispatch; FIFO sends rejected=280/300 in 6m; paid shipments waiting to enqueue=280; no later acknowledgements
receive-burst|burst|T|0|mixed|ReceiveMessage|RequestThrottled|400|The request was denied due to request throttling|workflow=email-delivery; worker receive burst rejected twice; next poll returned pending messages at 09:59; oldest message=8s; all due email sent
delete-pressure|consumer-cap|T|1|mixed|DeleteMessage|RequestThrottled|400|The request was denied due to request throttling|workflow=payment-confirmation; delete rejections=950 in 8m; unacked messages filling workers; unique pending confirmations=710; oldest message=31m; duplicate detector active
test-send-quota|rate-probe|T|0|direct|SendMessage|RequestThrottled|400|The request was denied due to request throttling|environment=staging; workflow=queue-capacity-test; test load stopped at 09:59; no customer messages in queue; production dispatch=430/430
kms-request-rate|kms-quota|T|1|mixed|SendMessage|KmsThrottled|400|The request was denied due to request throttling|workflow=invoice-enqueue; encrypted queue sends rejected=350/360; KMS request rate at configured limit; customer invoices not enqueued=350
probe-role|policy|A|0|direct|ReceiveMessage|AccessDenied|403|Access to the resource is denied|workflow=role-audit; disabled replay role rejected by production queue; active consumer processed 760/760; oldest message=0s
consumer-policy|policy|A|1|direct|ReceiveMessage|AccessDenied|403|Access to the resource is denied|workflow=refunds; active worker role denied; oldest message rose from 120s to 2100s over 33m; refunds past 15m target=182
expired-worker|credentials|A|0|mixed|DeleteMessage|InvalidSecurity|400|The request was not made using valid credentials|workflow=notification-ack; old session rejected; refreshed worker deleted the same message at 09:59; pending acknowledgements=0; duplicate notifications=0
queue-key-policy|kms-access|A|1|mixed|SendMessage|KmsAccessDenied|400|The caller does not have the required KMS access|environment=staging; workflow=settlement-events; live settlement publisher is using this stage queue after routing change; key policy removed sender grant; messages rejected=67/67 in 5m; settlement batches due in 4m cannot start
signature-probe|signature|A|0|uncertain|SendMessage|InvalidSecurity|400|The request was not made using valid credentials|workflow=signer-smoke-test; deliberately malformed test signature rejected; regular publisher sent 580/580 customer messages; pending customer sends=0
endpoint-reset|network-reset|D|1|direct|ReceiveMessage|ECONNRESET|-|read ECONNRESET|workflow=fulfillment; worker connections reset continuously for 14m; queue age=37m; warehouse dispatch cutoff in 6m; paid orders waiting=260
send-retry|remote-timeout|D|0|mixed|SendMessage|TimeoutError|-|Socket timed out without establishing a connection|workflow=alert-delivery; first call timed out before connection; application retry accepted at 09:59; unique alert receipts=30/30; duplicate alerts=0
resolver-outage|dns|D|1|mixed|SendMessage|ENOTFOUND|-|getaddrinfo ENOTFOUND sqs.us-east-1.amazonaws.com|workflow=order-events; resolver failed on 240/240 sends in 8m; captured payments awaiting event publication=240
dr-path|network-reset|D|0|mixed|ReceiveMessage|ECONNRESET|-|read ECONNRESET|workflow=shipment-notices; one worker lost network; second worker acknowledged every due message by 09:59; oldest message=3s; notices delivered=900/900
tls-cert|tls|D|1|uncertain|SendMessage|CERT_HAS_EXPIRED|-|certificate has expired|workflow=booking-events; local HTTPS proxy certificate expired; sends fail before service response; 165 confirmed bookings await downstream tickets; oldest wait=23m
old-receipt|input-validation|O|0|direct|DeleteMessage|ReceiptHandleIsInvalid|400|The input receipt handle is invalid|workflow=ack-cleanup; stale handle rejected after another worker deleted message; unique completions=900/900; visible backlog=0
queue-typo|missing-resource|O|1|direct|SendMessage|QueueDoesNotExist|400|The specified queue does not exist|workflow=shipment-create; publisher points to deleted queue URL after deployment; rejected events=312/312; shipping labels waiting=312
dedupe-test|conditional-write|O|0|mixed|SendMessage|InvalidParameterValue|400|The value for MessageDeduplicationId is invalid|workflow=publisher-test; invalid deduplication input rejected in test queue; production messages=780/780; oldest production message=2s
poison-loop|application-defect|O|1|mixed|decode-message|SyntaxError|-|Unexpected token in message JSON|workflow=refund-processing; same 46 messages returned repeatedly; receive count=18; no completed refunds for 25m; oldest message=41m
empty-poll|benign-signal|O|0|uncertain|ReceiveMessage|Observation|-|Long poll returned no messages|workflow=statement-delivery; empty receives=20; producer reconciliation=840/840 statements delivered; visible and in-flight counts=0; upstream published count=840
`);

add("API Gateway", `
method-budget|burst|T|1|direct|POST /orders|THROTTLED|429|Method request rate exceeded|workflow=order-submit; configured method rate=5/s; attempted=40/s; rejected=1850 in 10m; purchases incomplete=720
quota-archive|hourly-quota|T|0|mixed|GET /archive|QUOTA_EXCEEDED|429|Usage plan quota exceeded|workflow=archive-export; optional historical export quota reached; live invoice reads=1700/1700; next export deadline tomorrow; no pending current invoices
shared-stage|account-cap|T|1|mixed|GET /availability|THROTTLED|429|Stage request rate exceeded|workflow=inventory-availability; stage rate shared with crawler; customer availability errors=830/900; crawler stopped but latest minute still rejected=82/90
burst-cache|fallback|T|0|mixed|GET /catalog|THROTTLED|429|Stage request rate exceeded|workflow=public-catalog; origin 429s=45; edge served same version from cache for all 45; page success=3900/3900; cache freshness within contract
quota-tenant|hourly-quota|T|1|mixed|POST /shipments|QUOTA_EXCEEDED|429|Usage plan quota exceeded|workflow=warehouse-api; one tenant exhausted daily quota; fleet success=99%; tenant rejects=240/240 in 9m; 240 paid shipments due in 7m
expired-client|credentials|A|0|direct|GET /profile|EXPIRED_TOKEN|403|The security token included in the request is expired|workflow=profile-read; one old signed session rejected; refreshed session returned 200 at 09:59; active session reads=1200/1200
authorizer-deny|policy|A|1|direct|POST /checkout|ACCESS_DENIED|403|User is not authorized to access this resource|workflow=checkout-submit; authorizer policy deployment denied 560/570 active sessions; same sessions passed token validation probe; payment submissions blocked
signature-skew|signature|A|0|mixed|GET /status|INVALID_SIGNATURE|403|The request signature we calculated does not match|workflow=partner-status; one signing test rejected; current partner client completed 200/200 status reads; no overdue confirmations
issuer-reject|credentials|A|1|mixed|GET /subscriptions|UNAUTHORIZED|401|Unauthorized|workflow=subscription-list; new issuer tokens rejected=670/680 over 11m; previous issuer no longer issues tokens; paid users unable to load account subscriptions
invalid-key-audit|policy|A|0|uncertain|GET /reports|INVALID_API_KEY|403|Forbidden|workflow=key-retirement-audit; retired test key rejected; active customer keys returned 200 for 450/450 requests; zero customer reports pending
integration-down|upstream-http|D|1|direct|POST /reserve|INTEGRATION_FAILURE|504|Integration failed|workflow=reservation; integration health endpoint returns 503; gateway failures=390/400 in 8m; confirmed reservations=10; latest health probe still 503
timeout-retry|remote-timeout|D|0|mixed|GET /tracking|INTEGRATION_TIMEOUT|504|Endpoint request timed out|workflow=tracking; one integration deadline; retry returned current shipment position at 09:59; tracking success=1200/1200 after retry; repeated 504s=0
authorizer-connect|dns|D|1|mixed|GET /tickets|AUTHORIZER_CONFIGURATION_ERROR|500|Authorizer connection failed|workflow=ticket-download; authorizer endpoint DNS lookup fails in independent probe; gateway 500s=260/270; paid ticket downloads blocked=260
cached-weather|fallback|D|0|mixed|GET /forecast|INTEGRATION_FAILURE|504|Integration failed|workflow=weather-widget; optional origin fetch failed twice; verified cached forecast served; trip bookings=610/610; forecast age=3m within 15m target
reset-backend|network-reset|D|1|uncertain|POST /exports|INTEGRATION_FAILURE|504|Integration failed|workflow=customer-exports; backend probe reports connection reset on 31/32 attempts; gateway export failures=31/32; legal delivery deadline in 5m
unsupported-route|input-validation|O|0|direct|GET /obsolete|MISSING_AUTHENTICATION_TOKEN|403|Missing Authentication Token|workflow=route-probe; request used removed route; no authorizer attached to this method; published customer route returned 200 on 700/700; no customer use of removed path
mapping-release|schema-change|O|1|direct|POST /payments|API_CONFIGURATION_ERROR|500|Invalid API configuration|workflow=payment-submit; mapping deployment changed required integration field; 480/480 requests fail before backend; captured payment submissions waiting=480
oversize-test|input-validation|O|0|mixed|POST /upload|REQUEST_TOO_LARGE|413|HTTP content length exceeded 10485760 bytes|environment=staging; workflow=upload-limit-test; synthetic oversized request rejected; production uploads=260/260; no customer records in test payload
body-regression|application-defect|O|1|mixed|POST /renewals|BAD_REQUEST_BODY|400|Request body validation failed|workflow=renewal-submit; released client omits new required field; 322/330 renewing subscribers rejected in 8m; backend sees only 8 requests
opaque-504|unknown-timeout|O|0|uncertain|GET /recommendations|-|504|Application returned 504 without diagnostic trace|workflow=recommendations; access status=504 from integration response; no gateway error type; integration traces unavailable; subsequent requests=2300/2300; isolated affected request
`);

add("RDS PostgreSQL", `
db-connection-limit|connection-cap|T|1|direct|connect|FATAL|-|too many connections for database "appdb"|workflow=order-ledger; appdb connection limit=40; new connection rejects=420/430; paid orders waiting=420; rejection continues
role-limit-retry|connection-cap|T|0|mixed|connect|FATAL|-|too many connections for role "worker"|workflow=report-worker; role connection limit=2; one job rejected while two completed; retry committed at 09:59; remaining jobs=0; reports due=40 and delivered=40
global-slot-cap|concurrency|T|1|mixed|connect|FATAL|-|sorry, too many clients already|workflow=login-sessions; database client slots exhausted; new sessions rejected=610/620 over 10m; existing session health checks pass
maintenance-cap|rate-probe|T|0|direct|connect|FATAL|-|too many connections for database "appdb"|workflow=maintenance-scan; database cap rejected one optional scan; customer session pool already connected; customer transactions committed=3100/3100; scan deadline slack=20h
role-cap-cohort|consumer-cap|T|1|mixed|connect|FATAL|-|too many connections for role "worker"|workflow=payout-writer; worker role capped at one session; long-running batch holds it; new payout connections rejected=180; oldest payout wait=38m; promised wait=15m
stale-password|credentials|A|0|direct|connect|FATAL|-|password authentication failed for user "worker"|workflow=credential-probe; old secret version rejected; active secret connected and committed at 09:59; production transactions=1900/1900
revoke-table|policy|A|1|direct|SELECT * FROM orders;|ERROR|-|permission denied for table orders|workflow=order-history; reader grant revoked; reads fail=810/820 in 9m; authenticated customers cannot load order history
schema-grant-probe|policy|A|0|mixed|SELECT * FROM private.audit;|ERROR|-|permission denied for schema private|workflow=least-privilege-test; test attempts restricted audit schema; expected restricted operation rejected; customer order reads=460/460
connect-grant|policy|A|1|mixed|connect|FATAL|-|permission denied for database "appdb"|workflow=wallet-history; CONNECT privilege removed from active worker role; requests failed=340/340 since 09:52; history pages unavailable
old-function-role|policy|A|0|uncertain|SELECT rebuild_cache();|ERROR|-|permission denied for function rebuild_cache|workflow=retired-cache-job; obsolete role attempted maintenance function; active cache current as of 09:59; customer reads=850/850
shutdown-window|db-shutdown|D|1|direct|session|FATAL|-|terminating connection due to administrator command|workflow=checkout-ledger; current writer terminated; replacement connections refused continuously for 9m; checkout commits=0/410; no active writer available
failover-reconnect|db-shutdown|D|0|mixed|session|FATAL|-|terminating connection due to administrator command|workflow=receipt-store; planned failover dropped one session; new writer committed pending receipt at 09:59; acknowledgements=850/850; queue empty
network-read-reset|network-reset|D|1|mixed|session|LOG|-|could not receive data from client: Connection reset by peer|workflow=invoice-write; network probe also resets connections; invoice writes unacknowledged=240/250 in 12m; reconciliation missing=240; retry path still resetting
readonly-promotion|db-shutdown|D|0|mixed|INSERT INTO receipts(id) VALUES (8);|ERROR|-|cannot execute INSERT in a read-only transaction|workflow=receipt-failover; client was on known recovery replica during promotion; retry on writer committed receipt at 09:59; outstanding receipts=0
storage-unavailable|storage|D|1|uncertain|INSERT INTO orders(id) VALUES (9);|ERROR|-|could not extend file "base/16384/16400": No space left on device|workflow=order-write; free storage=0 bytes; writes fail=270/270 for 8m; paid orders cannot commit; read-only health checks still pass
duplicate-id|conditional-write|O|0|direct|INSERT INTO receipts(id) VALUES (7);|ERROR|-|duplicate key value violates unique constraint "receipts_pkey"|workflow=receipt-idempotency; repeated event used existing receipt ID; original receipt delivered; unique receipts=720/720; duplicate sends=0
missing-column|schema-change|O|1|direct|SELECT total_cents FROM orders;|ERROR|-|column "total_cents" does not exist|workflow=invoice-read; application release references missing column; requests fail=290/300; customer invoice downloads unavailable
timeout-cancel|input-validation|O|0|mixed|SELECT pg_sleep(2);|ERROR|-|canceling statement due to statement timeout|workflow=query-timeout-test; synthetic pg_sleep exceeded configured 100ms deadline; customer queries=1800/1800; no pending test work
deadlock-repeat|lock-contention|O|1|mixed|UPDATE orders SET state = 'ready' WHERE id = 4;|ERROR|-|deadlock detected|workflow=shipment-state; conflicting update order repeats every retry; batches failed=62/62 in 18m; paid shipments waiting=620; no progress after retries
unclear-cancel|unknown-timeout|O|0|uncertain|SELECT state FROM orders WHERE id = 4;|ERROR|-|canceling statement due to user request|workflow=status-refresh; single client cancellation; caller span missing; later status reads=1600/1600; no repeated delay or backlog
`);

add("RDS MySQL", `
server-connection-cap|connection-cap|T|1|direct|connect|ER_CON_COUNT_ERROR|-|Too many connections|workflow=reservation-store; max_connections=120; clients connected=120; new connection rejects=389/400 in 10m; bookings cannot commit
user-session-retry|connection-cap|T|0|mixed|connect|ER_TOO_MANY_USER_CONNECTIONS|-|User worker already has more than 'max_user_connections' active connections|workflow=export-worker; max_user_connections=2; rejected job retried after existing jobs finished at 09:59; files delivered=80/80
hourly-queries|hourly-quota|T|1|mixed|query|ER_USER_LIMIT_REACHED|-|User 'worker' has exceeded the 'max_questions' resource (current value: 100)|workflow=pricing-read; hourly query quota reached after 100 queries; customer price reads rejected=280/280; quota reset in 42m
offline-cap|rate-probe|T|0|direct|connect|ER_CON_COUNT_ERROR|-|Too many connections|workflow=offline-audit; optional audit connection rejected; customer pooled sessions continue; purchases committed=2400/2400; audit due tomorrow
writer-user-cap|consumer-cap|T|1|mixed|connect|ER_TOO_MANY_USER_CONNECTIONS|-|User worker already has more than 'max_user_connections' active connections|workflow=refund-store; role cap=1; stuck session holds only slot; refunds waiting=180; oldest wait=34m and rising
old-login|credentials|A|0|direct|connect|ER_ACCESS_DENIED_ERROR|-|Access denied for user 'worker'@'192.0.2.44' (using password: YES)|workflow=secret-rotation-check; retired credential rejected; current credential committed test row at 09:59; customer writes=950/950
table-grant|policy|A|1|direct|query|ER_TABLEACCESS_DENIED_ERROR|-|SELECT command denied to user 'worker'@'192.0.2.44' for table 'orders'|workflow=order-details; SELECT grant removed; requests fail=640/650 over 10m; paid customers cannot view orders
restricted-admin|policy|A|0|mixed|query|ER_SPECIFIC_ACCESS_DENIED_ERROR|-|Access denied; you need (at least one of) the RELOAD privilege(s) for this operation|workflow=privilege-audit; restricted maintenance command rejected; application role never uses this command; customer queries=1800/1800
database-grant|policy|A|1|mixed|connect|ER_DBACCESS_DENIED_ERROR|-|Access denied for user 'worker'@'192.0.2.44' to database 'appdb'|workflow=wallet-read; worker database grant revoked; connection failures=290/290 since 09:53; customer balances unavailable
revoked-user-check|credentials|A|0|uncertain|connect|ER_ACCESS_DENIED_ERROR|-|Access denied for user 'worker'@'192.0.2.44' (using password: YES)|workflow=retired-user-check; removed service account probe failed; new service account processed 510/510 customer statements; queue empty
writer-offline|db-shutdown|D|1|direct|connect|ECONNREFUSED|-|connect ECONNREFUSED 192.0.2.60:3306|workflow=invoice-store; writer endpoint refuses connections on 62/62 attempts in 11m; paid invoices pending=620; no replacement writer connected
socket-recovered|network-reset|D|0|mixed|query|ECONNRESET|-|read ECONNRESET|workflow=session-store; one connection reset; new session wrote state at 09:59; user requests=1500/1500 after retry; pending writes=0
dns-writer|dns|D|1|mixed|connect|ENOTFOUND|-|getaddrinfo ENOTFOUND writer.example.invalid|workflow=booking-ledger; writer name lookup failed=250/250 in 8m; confirmed bookings await ledger commit; read replica health probe succeeds
cache-read|network-reset|D|0|mixed|query|PROTOCOL_CONNECTION_LOST|-|Connection lost: The server closed the connection.|workflow=rate-display; read connection lost; signed daily-rate snapshot served all 300 affected reads; quotes reconcile; snapshot expires tomorrow
tls-proxy|tls|D|1|uncertain|connect|CERT_HAS_EXPIRED|-|certificate has expired|workflow=subscription-store; proxy TLS handshake fails before authentication; renewals failed=172/180; expiring subscriptions waiting=172; newest attempt also fails
duplicate-insert|conditional-write|O|0|direct|query|ER_DUP_ENTRY|-|Duplicate entry '7' for key 'receipts.PRIMARY'|workflow=receipt-import; replay duplicated an existing key; original receipt confirmed; unique receipts=620/620; no extra charges
removed-table|missing-resource|O|1|direct|query|ER_NO_SUCH_TABLE|-|Table 'appdb.orders_v2' doesn't exist|workflow=customer-orders; application points at absent table; requests fail=890/900 over 9m; customer order views unavailable
invalid-sql-test|input-validation|O|0|mixed|query|ER_PARSE_ERROR|-|You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'FROM orders' at line 1|environment=staging; workflow=query-builder-test; synthetic malformed SELECT rejected; production reads=750/750; no real customer rows used
lock-wait-loop|lock-contention|O|1|mixed|query|ER_LOCK_WAIT_TIMEOUT|-|Lock wait timeout exceeded; try restarting transaction|workflow=payment-state; transaction holds row lock; retry loop blocked 340/340 updates for 20m; customer payment status remains pending beyond 5m target
client-budget-unknown|unknown-timeout|O|0|uncertain|query-budget|Observation|-|Caller stopped waiting; database outcome not captured|workflow=optional-recommendations; one caller deadline; database trace cannot correlate the query; subsequent requests=2100/2100; no queue growth
`);

// Matched mechanisms with different customer consequences. Variants share a split.
function counterpart(original, key, observations) {
  const base = cases.find((c) => c.key === original);
  if (!base) throw new Error(`Missing counterpart source ${original}`);
  cases.push({ ...base, key, basedOn: original, attention: !base.attention, difficulty: "mixed", observations });
}

counterpart("read-fallback", "fallback-stale-cohort",
  "workflow=public-catalog; snapshot served 120 requests at 09:59; version audit found 72 prices older than customer contract; live reads still return 500; 72 purchases awaiting a valid price; snapshot cannot serve those products");
counterpart("timeout-unclear", "unknown-budget-sustained",
  "workflow=account-renewal; request deadlines exceeded on 84/90 attempts in 12m; latest failure at 09:59; dependency spans and local execution traces missing; 84 renewals remain unconfirmed; no successful completion after 09:55");
counterpart("poison-loop", "quarantined-message",
  "workflow=refund-processing; malformed replay message quarantined after one receive; original refund reconciles; 420/420 customer refunds completed; quarantine contains no unprocessed customer refunds");
counterpart("deadlock-repeat", "deadlock-recovered",
  "workflow=shipment-state; two transactions acquired rows in opposite order; one deadlock victim retried after 120ms; 620/620 shipments updated; oldest pending shipment=0s; latest 200 writes committed");
counterpart("invalid-sql-test", "invalid-sql-customer",
  "workflow=order-read; client query text is SELECT FROM orders; 418/420 customer requests returned syntax errors in 8m; two requests used the previous client; latest request at 09:59 also failed; customer order histories unavailable");
counterpart("delete-pressure", "delete-pressure-recovered",
  "workflow=payment-confirmation; two delete calls rejected; delayed acknowledgements later succeeded; unique confirmations=710/710; in-flight messages=0; oldest pending confirmation=0s; latest worker poll healthy");
counterpart("fifo-send-rate", "fifo-rate-buffered",
  "workflow=dispatch; 3 FIFO sends rejected during a batch; application buffer drained after backoff; shipment enqueue acknowledgements=300/300; duplicate shipment IDs=0; dispatch deadline slack=6h");
counterpart("tls-cert", "tls-secondary-recovered",
  "workflow=booking-events; one proxy TLS handshake failed; second configured proxy accepted the event at 09:59; ticket confirmations=165/165; no unpublished booking events; latest 80 sends succeeded");
counterpart("probe-rate", "probe-shared-customers",
  "environment=staging; workflow=capacity-probe; paid shipping work also routed to this stage; capacity test consumed shared function slots; 183/190 paid invocations rejected in 5m; test stopped at 09:59 but latest 12 paid calls still rejected; labels due in 2m");
counterpart("empty-poll", "empty-poll-missing-work",
  "workflow=statement-delivery; receives empty; queue visible and in-flight counts=0; billing reconciliation has 86 paid statements without delivery receipts; publisher and consumer traces missing; statement deadline in 2m; cause not established");
counterpart("kms-key-denial", "kms-optional-audit",
  "workflow=journal-audit; optional duplicate audit sink rejected encryption-key access; required journal committed 230/230 transactions through the primary sink; reconciliation current; optional audit due in 3 days");
counterpart("missing-column", "schema-canary-stopped",
  "workflow=invoice-read; canary query references absent total_cents column; rollout stopped before customer routing; active query uses total_amount and served 300/300 customer downloads; no invoices pending");
counterpart("condition-race", "condition-retry-starvation",
  "workflow=receipt-commit; conditional version check rejected 260/260 attempts in 9m; reconciliation finds no committed receipt for these payments; latest retry rejected at 09:59; receipt deadline=10m; oldest unreceipted payment=16m");
counterpart("inventory-upstream", "upstream-optional-recovered",
  "workflow=cart-enrichment; optional inventory detail request returned 503; local signed inventory feed served all 400 reservations with matching stock version; completed carts=400/400; pending reservations=0");
counterpart("kms-request-rate", "kms-rate-retry",
  "workflow=invoice-enqueue; one encrypted queue send exceeded KMS request rate; backoff completed the send; unique invoice events accepted=360/360; unpublished invoices=0; oldest pending send=0s");
counterpart("storage-unavailable", "storage-archive-recovered",
  "workflow=historical-order-copy; optional archive database storage exhausted; archive job paused; live writer on separate instance committed 270/270 purchases; archive retention deadline slack=14 days; no customer reads use archive");
counterpart("child-concurrency", "concurrency-drained",
  "workflow=checkout; child reserved concurrency=4; one burst rejected 3 invocations; client retries completed all 400 checkouts; newest 90 calls accepted; pending customer requests=0");
counterpart("gsi-hot-key", "hot-partition-cache",
  "workflow=product-search; GSI index reads rejected during hot-key burst; version-matched local index served all 1000 searches; freshness age=20s within 60s contract; latest cache refresh completed; no searches waiting");
counterpart("wrong-table", "missing-optional-resource",
  "workflow=pricing-audit; optional audit lookup targeted a deleted table; primary price table served 850/850 customer lookups; purchases completed=850/850; audit scheduled for next week; no pending price decisions");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uuid(key) {
  const h = digest(key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const heading = (source, view) => `[source: ${source} | view: ${view}]`;
const time = (ms) => new Date(Date.parse("2026-10-18T09:58:00Z") + ms).toISOString();
const json = (value) => JSON.stringify(value);

function errorFields(c) {
  const fields = { name: c.name, message: c.message };
  if (c.status !== null) Object.assign(fields, { httpStatusCode: c.status,
    requestId: c.source === "DynamoDB" ? digest(c.key + "-service").slice(0, 52).toUpperCase() : uuid(c.key + "-service") });
  return fields;
}

function clientLogs(c) {
  const base = { service: c.source, operation: c.operation };
  const connectionId = c.source === "RDS MySQL" && mysqlQuery(c) ? 100 + cases.indexOf(c) : undefined;
  const delay = (c.basedOn ?? c.key) === "lock-wait-loop" ? 2000 : 0;
  const offset = parseInt(digest(c.key).slice(0, 4), 16) % 45000;
  return [
    { time: time(offset), level: "INFO", ...base, event: "request_start" },
    { time: time(offset + 20 + delay), level: c.name === "Observation" ? "INFO" : "ERROR", ...base, event: "call_observation", ...errorFields(c), connectionId },
    { time: time(offset + 100 + delay), level: "INFO", ...base, event: "observation_window_closed", windowSeconds: 600 },
  ].map(json).join("\n");
}

function mysqlQuery(c) {
  return {
    "hourly-queries": "SELECT price FROM products",
    "table-grant": "SELECT * FROM orders",
    "restricted-admin": "FLUSH TABLES",
    "duplicate-insert": "INSERT INTO receipts(id) VALUES (7)",
    "removed-table": "SELECT * FROM orders_v2",
    "invalid-sql-test": "SELECT FROM orders",
    "lock-wait-loop": "UPDATE payments SET state = 'posted' WHERE id = 4",
  }[c.basedOn ?? c.key];
}

function lambdaLogs(c) {
  const id = uuid(c.key);
  const seed = parseInt(digest(c.key).slice(0, 4), 16);
  const offset = seed % 45000;
  const duration = 120 + seed % 900 + (seed % 99) / 100;
  const memory = [128, 256, 512][seed % 3];
  const app = (ms, level, payload) => `${time(offset + ms)}\t${id}\t${level}\t${json(payload)}`;
  return [
    `START RequestId: ${id} Version: $LATEST`,
    app(10, "INFO", { event: "handler_enter", service: "orchestrator" }),
    app(20, "ERROR", { event: "call_observation", operation: c.operation, ...errorFields(c) }),
    app(100, "INFO", { event: "handler_return", handled: true }),
    `END RequestId: ${id}`,
    `REPORT RequestId: ${id}\tDuration: ${duration.toFixed(2)} ms\tBilled Duration: ${Math.ceil(duration)} ms\tMemory Size: ${memory} MB\tMax Memory Used: ${Math.floor(memory * (0.3 + seed % 40 / 100))} MB`,
  ].join("\n");
}

function accessLogs(c) {
  const [method, path] = c.operation.split(" ");
  const seed = parseInt(digest(c.key).slice(0, 4), 16);
  const errorIndex = seed % 3;
  return Array.from({ length: 3 }, (_, i) => json({
    requestId: uuid(c.key + i), extendedRequestId: Buffer.from(digest(c.key + i).slice(0, 9)).toString("base64"),
    ip: "192.0.2.44", requestTime: `18/Oct/2026:09:58:${String(seed % 40 + i).padStart(2, "0")} +0000`, httpMethod: i === errorIndex ? method : "GET",
    resourcePath: i === errorIndex ? path : ["/health", "/status", "/ping"][seed % 3],
    status: String(i === errorIndex ? c.status : 200), protocol: "HTTP/1.1", responseLength: i === errorIndex ? "42" : "128",
    responseType: i === errorIndex ? c.name : "-",
  })).join("\n");
}

function pgLogs(c, index) {
  const prefix = (ms, pid) => `2026-10-18 09:58:00.${String(ms).padStart(3, "0")} UTC [${pid}] worker@appdb `;
  const pid = 7000 + index * 2;
  const rows = [prefix(10, pid) + "LOG:  duration: 0.100 ms  statement: SELECT 1;",
    prefix(20, pid + 1) + `${c.name}:  ${c.message}`];
  if (c.name === "ERROR") rows.push(prefix(20, pid + 1) + `STATEMENT:  ${c.operation}`);
  if (c.key === "duplicate-id") rows.splice(2, 0, prefix(20, pid + 1) + "DETAIL:  Key (id)=(7) already exists.");
  if ((c.basedOn ?? c.key) === "deadlock-repeat") rows.splice(2, 0,
    prefix(20, pid + 1) + `DETAIL:  Process ${pid + 1} waits for ShareLock on transaction 801; blocked by process ${pid + 2}.\n\tProcess ${pid + 2} waits for ShareLock on transaction 802; blocked by process ${pid + 1}.\n\tProcess ${pid + 1}: ${c.operation}\n\tProcess ${pid + 2}: UPDATE orders SET state = 'ready' WHERE id = 5;`,
    prefix(20, pid + 1) + "HINT:  See server log for query details.");
  return rows.join("\n");
}

function mysqlLogs(c, index) {
  const thread = String(100 + index).padStart(5, " ");
  const offset = parseInt(digest(c.key).slice(0, 4), 16) % 45000;
  const record = (ms, command, argument) => `${time(offset + ms).replace("Z", "000Z")}\t${thread} ${command}\t${argument}`;
  const query = mysqlQuery(c);
  const user = query ? "worker" : "observer";
  const records = [record(1, "Connect", `${user}@192.0.2.44 on appdb using SSL/TLS`)];
  // log_raw=OFF suppresses an unparseable statement from the general log.
  if (c.name !== "ER_PARSE_ERROR") records.push(record(2, "Query", query ?? "SELECT 1"));
  records.push(record((c.basedOn ?? c.key) === "lock-wait-loop" ? 2100 : 100, "Quit", ""));
  return records.join("\n");
}

function excerpts(c, index) {
  if (c.source === "Lambda") return [{ profile: "lambda-node22-text", source: "Lambda orchestrator", view: "CloudWatch message strings", text: lambdaLogs(c) }];
  if (c.source === "API Gateway") return [{ profile: "apigw-rest-json", source: "API Gateway REST access", view: "CloudWatch message strings", text: accessLogs(c) }];
  if (c.source === "RDS PostgreSQL") return [{ profile: "rds-pg16-stderr", source: "RDS PostgreSQL 16 stderr", view: "raw downloaded file", text: pgLogs(c, index) }];
  const caller = { profile: "node24-client-json", source: `${c.source} caller stdout`, view: "raw stdout", text: clientLogs(c) };
  return c.source === "RDS MySQL" ? [
    { profile: "rds-mysql80-general", source: mysqlQuery(c) ? "RDS MySQL 8.0 writer general" : "RDS MySQL 8.0 observer replica general", view: "raw downloaded file", text: mysqlLogs(c, index) }, caller,
  ] : [caller];
}

const dataset = [];
const notes = [];
for (const [index, c] of cases.entries()) {
  const id = digest("incident-v2:" + c.key).slice(0, 16);
  const sections = excerpts(c, index);
  const environment = c.observations.startsWith("environment=staging;") ? "staging" : "production";
  const observations = c.observations.replace(/^environment=staging; /, "")
    .replaceAll("at 09:59", `at 09:59:${String(parseInt(digest(c.key).slice(0, 2), 16) % 50).padStart(2, "0")}Z`);
  sections.push({ profile: "operations-v1", source: "operations", view: "synthetic worksheet",
    text: `2026-10-18T10:00:04.000Z | environment=${environment}; window=09:20:00Z/10:00:04Z; cutoff=2026-10-18T10:00:04.000Z\n2026-10-18T10:00:04.000Z | ${observations}` });
  const description = sections.map(({ source, view, text }) => `${heading(source, view)}\n${text}`).join("\n");
  dataset.push({ id, description, expectedCategory: c.category, expectedRequiresAttention: c.attention });
  const categoryReason = c.category === "other"
    ? `The visible ${c.name} observation and workflow evidence support a local defect, input/consistency condition, or unknown cause: ${c.message}. None establishes a rate, access, or downstream availability cause.`
    : `${c.category} is supported by ${c.message}. The affected operation and customer consequences are evaluated separately.`;
  notes.push({ id, scenario: c.key, scenarioFamily: c.family, split: heldOutFamilies.has(c.family) ? "held-out" : "development",
    source: c.source, environment, difficulty: c.difficulty, decisionCutoff: "2026-10-18T10:00:04.000Z",
    excerpts: sections.map(({ profile, source, view }) => ({ profile, source, view })),
    expectedCategory: c.category, expectedRequiresAttention: c.attention, counterpartOf: c.basedOn ?? null,
    categoryReason, attentionReason: observations,
    review: "Reviewed against decisions.js before provider answers; independent human annotation pending.",
    resolution: c.family === "unknown-timeout" ? `No visible causal trace: retain other. ${c.attention ? "Repeated failures and overdue customer work require attention despite unknown cause." : "An isolated recovered observation does not establish ongoing material harm."}`
      : c.key === "readonly-promotion" ? "Known recovery replica during failover supports dependency unavailability rather than an unexplained read-only application setting."
        : c.key === "unsupported-route" ? "MISSING_AUTHENTICATION_TOKEN also covers an unsupported route; this case visibly uses a removed route without an authorizer, so retain other."
          : "Specific cause and decision-time impact reviewed separately; no category-only urgency rule." });
}

// Shuffle by an unrelated digest so dataset order and opaque IDs don't encode labels.
dataset.sort((a, b) => digest(a.id + ":order").localeCompare(digest(b.id + ":order")));
notes.sort((a, b) => dataset.findIndex(({ id }) => id === a.id) - dataset.findIndex(({ id }) => id === b.id));
const contents = `${JSON.stringify(dataset, null, 2)}\n`;
await writeFile(new URL("./incidents.json", import.meta.url), contents);
await writeFile(new URL("./incident-notes.json", import.meta.url), `${JSON.stringify({
  version: "synthetic-aws-v3", count: dataset.length, sha256: digest(contents), reviewedOn: "2026-10-19",
  reviewMethod: "Author and agent policy review before inference; independent human annotation pending. No provider answers used.",
  independentReview: { status: "pending", reviewer: null }, cases: notes,
}, null, 2)}\n`);
console.log(`Wrote ${dataset.length} synthetic incidents and evaluation-only notes.`);
