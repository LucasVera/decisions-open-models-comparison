import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildIncidentInput } from "../decisions.js";
import { DATASET_PATH } from "../evaluation.js";

const contents = await readFile(DATASET_PATH, "utf8");
const dataset = JSON.parse(contents);
const notes = JSON.parse(await readFile(new URL("../data/incident-notes.json", import.meta.url), "utf8"));
const uuid = "[a-f\\d]{8}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{4}-[a-f\\d]{12}";
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const categories = ["throttling", "authentication", "dependency_failure", "other"];

function timestamp(value) {
  assert.match(value, iso);
  const result = Date.parse(value);
  assert.ok(Number.isFinite(result));
  assert.equal(new Date(result).toISOString(), value);
  return result;
}

function ordered(times) {
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] >= times[i - 1], "time ordering");
}

function sections(description) {
  const result = [];
  for (const line of description.split("\n")) {
    const match = /^\[source: (.+) \| view: (.+)\]$/.exec(line);
    if (match) result.push({ source: match[1], view: match[2], lines: [] });
    else {
      assert.ok(result.length > 0, "source heading required");
      result.at(-1).lines.push(line);
    }
  }
  return result;
}

function lambda(lines) {
  assert.ok(lines.length >= 4);
  const start = new RegExp(`^START RequestId: (${uuid}) Version: \\$LATEST$`, "i").exec(lines[0]);
  assert.ok(start, "Lambda START");
  const id = start[1];
  assert.equal(lines.at(-2), `END RequestId: ${id}`);
  const report = new RegExp(`^REPORT RequestId: ${id}\\tDuration: ([\\d.]+) ms\\tBilled Duration: (\\d+) ms\\tMemory Size: (\\d+) MB\\tMax Memory Used: (\\d+) MB$`).exec(lines.at(-1));
  assert.ok(report, "warm text REPORT units and conditional fields");
  const [, duration, billed, memory, used] = report.map(Number);
  assert.ok(duration > 0 && used > 0 && used <= memory);
  assert.equal(billed, Math.ceil(duration));
  const times = lines.slice(1, -2).map((line) => {
    const fields = line.split("\t");
    assert.equal(fields.length, 4, "one application event per line");
    assert.equal(fields[1], id);
    assert.ok(["INFO", "ERROR", "WARN"].includes(fields[2]));
    const payload = JSON.parse(fields[3]);
    assert.equal(typeof payload.event, "string");
    return timestamp(fields[0]);
  });
  ordered(times);
  assert.ok(times.at(-1) - times[0] <= duration, "application interval within invocation duration");
  return times;
}

const localErrors = new Set(["ECONNRESET", "ENOTFOUND", "TimeoutError", "CERT_HAS_EXPIRED", "ECONNREFUSED",
  "PROTOCOL_CONNECTION_LOST", "TypeError", "SyntaxError", "Observation"]);
const serviceErrors = {
  SQS: new Set(["RequestThrottled", "KmsThrottled", "AccessDenied", "InvalidSecurity", "KmsAccessDenied",
    "ReceiptHandleIsInvalid", "QueueDoesNotExist", "InvalidParameterValue"]),
  DynamoDB: new Set(["ProvisionedThroughputExceededException", "RequestLimitExceeded", "ThrottlingException",
    "ExpiredTokenException", "AccessDeniedException", "IncompleteSignatureException", "InternalServerError",
    "ConditionalCheckFailedException", "ResourceNotFoundException", "ValidationException"]),
};

const operationsByService = {
  SQS: new Set(["SendMessage", "ReceiveMessage", "DeleteMessage", "decode-message"]),
  DynamoDB: new Set(["Query", "PutItem", "GetItem", "DescribeTable", "Scan", "UpdateItem", "TransactWriteItems", "BatchWriteItem", "marshall", "request-budget"]),
  "RDS MySQL": new Set(["connect", "query", "query-budget"]),
};
const sqsErrorsByOperation = {
  SendMessage: new Set(["RequestThrottled", "KmsThrottled", "AccessDenied", "InvalidSecurity", "KmsAccessDenied", "QueueDoesNotExist", "InvalidParameterValue"]),
  ReceiveMessage: new Set(["RequestThrottled", "KmsThrottled", "AccessDenied", "InvalidSecurity", "KmsAccessDenied", "QueueDoesNotExist"]),
  DeleteMessage: new Set(["RequestThrottled", "AccessDenied", "InvalidSecurity", "QueueDoesNotExist", "ReceiptHandleIsInvalid"]),
};
const dynamoErrorsByOperation = {
  ProvisionedThroughputExceededException: new Set(["Query", "Scan", "GetItem", "PutItem", "UpdateItem", "TransactWriteItems", "BatchWriteItem"]),
  ConditionalCheckFailedException: new Set(["PutItem", "UpdateItem"]),
  ValidationException: new Set(["Query", "Scan", "GetItem", "PutItem", "UpdateItem", "TransactWriteItems", "BatchWriteItem"]),
};
const mysqlMessages = {
  ER_CON_COUNT_ERROR: /^Too many connections$/,
  ER_TOO_MANY_USER_CONNECTIONS: /^User \w+ already has more than 'max_user_connections' active connections$/,
  ER_USER_LIMIT_REACHED: /^User '\w+' has exceeded the 'max_questions' resource \(current value: \d+\)$/,
  ER_ACCESS_DENIED_ERROR: /^Access denied for user '\w+'@'192\.0\.2\.\d+' \(using password: YES\)$/,
  ER_TABLEACCESS_DENIED_ERROR: /^SELECT command denied to user '\w+'@'192\.0\.2\.\d+' for table '\w+'$/,
  ER_SPECIFIC_ACCESS_DENIED_ERROR: /^Access denied; you need \(at least one of\) the RELOAD privilege\(s\) for this operation$/,
  ER_DBACCESS_DENIED_ERROR: /^Access denied for user '\w+'@'192\.0\.2\.\d+' to database '\w+'$/,
  ER_DUP_ENTRY: /^Duplicate entry '.+' for key '.+'$/,
  ER_NO_SUCH_TABLE: /^Table '\w+\.\w+' doesn't exist$/,
  ER_PARSE_ERROR: /^You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '.+' at line \d+$/,
  ER_LOCK_WAIT_TIMEOUT: /^Lock wait timeout exceeded; try restarting transaction$/,
};

function serviceError(event) {
  assert.ok(serviceErrors[event.service]?.has(event.name), "documented service error name");
  if (event.service === "SQS") {
    assert.ok(sqsErrorsByOperation[event.operation]?.has(event.name), "SQS operation/error relationship");
    assert.equal(event.httpStatusCode, event.name === "AccessDenied" ? 403 : 400, "SQS error/status relationship");
    assert.match(event.requestId, new RegExp(`^${uuid}$`, "i"));
  } else {
    assert.ok(!["marshall", "request-budget"].includes(event.operation), "AWS response requires an SDK operation");
    const operations = dynamoErrorsByOperation[event.name];
    if (operations) assert.ok(operations.has(event.operation), "DynamoDB operation/error relationship");
    assert.equal(event.httpStatusCode, event.name === "InternalServerError" ? 500 : 400, "DynamoDB error/status relationship");
    assert.match(event.requestId, /^[A-Z\d]{52}$/, "selected DynamoDB request ID profile");
  }
}

function client(lines) {
  assert.ok(lines.length >= 1);
  const events = lines.map((line) => JSON.parse(line));
  for (const event of events) {
    for (const field of ["time", "level", "service", "operation", "event"]) {
      assert.equal(typeof event[field], "string", `caller ${field}`);
    }
    assert.ok(["INFO", "WARN", "ERROR"].includes(event.level));
    assert.ok(operationsByService[event.service]?.has(event.operation), "service/operation relationship");
    if (event.name) {
      assert.equal(typeof event.message, "string");
      if (serviceErrors[event.service] && !localErrors.has(event.name)) {
        serviceError(event);
      }
      if (localErrors.has(event.name) || event.name.startsWith("ER_")) {
        assert.equal(event.httpStatusCode, undefined, "local/database errors have no AWS HTTP status");
        assert.equal(event.requestId, undefined, "no service response ID on a local failure");
        if (event.name.startsWith("ER_")) {
          assert.equal(event.service, "RDS MySQL");
          assert.ok(mysqlMessages[event.name], "selected MySQL error code");
          assert.match(event.message, mysqlMessages[event.name], "MySQL 8.0.44 English message");
        }
      } else {
        assert.ok(serviceErrors[event.service], "service errors require a declared AWS service");
      }
    }
    assert.equal(event.Authorization, undefined);
  }
  assert.equal(new Set(events.map(({ service }) => service)).size, 1);
  assert.equal(new Set(events.map(({ operation }) => operation)).size, 1);
  const times = events.map(({ time }) => timestamp(time));
  ordered(times);
  return times;
}

const gatewayStatuses = { THROTTLED: "429", QUOTA_EXCEEDED: "429", ACCESS_DENIED: "403", EXPIRED_TOKEN: "403",
  INVALID_SIGNATURE: "403", UNAUTHORIZED: "401", INVALID_API_KEY: "403", INTEGRATION_FAILURE: "504",
  INTEGRATION_TIMEOUT: "504", AUTHORIZER_CONFIGURATION_ERROR: "500", MISSING_AUTHENTICATION_TOKEN: "403",
  API_CONFIGURATION_ERROR: "500", REQUEST_TOO_LARGE: "413", BAD_REQUEST_BODY: "400" };

function gateway(lines) {
  const ids = new Set();
  const times = lines.map((line) => {
    const event = JSON.parse(line);
    assert.deepEqual(Object.keys(event).sort(), ["requestId", "extendedRequestId", "ip", "requestTime", "httpMethod",
      "resourcePath", "status", "protocol", "responseLength", "responseType"].sort());
    for (const value of Object.values(event)) assert.equal(typeof value, "string");
    assert.match(event.requestId, new RegExp(`^${uuid}$`, "i"));
    assert.ok(!ids.has(event.requestId));
    ids.add(event.requestId);
    assert.match(event.extendedRequestId, /^[A-Za-z\d+/=]+$/);
    assert.match(event.ip, /^192\.0\.2\.\d+$/);
    assert.match(event.requestTime, /^\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2} \+0000$/);
    assert.ok(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(event.httpMethod));
    assert.equal(event.protocol, "HTTP/1.1");
    assert.match(event.resourcePath, /^\//);
    assert.match(event.status, /^[2-5]\d{2}$/);
    assert.match(event.responseLength, /^\d+$/);
    if (event.responseType !== "-") assert.equal(event.status, gatewayStatuses[event.responseType], "gateway response path");
    const value = Date.parse(event.requestTime.replace(/^(\d+)\/(\w+)\/(\d+):/, "$2 $1 $3 "));
    assert.ok(Number.isFinite(value));
    return value;
  });
  ordered(times);
  return times;
}

function postgres(lines) {
  const times = [];
  const terminated = new Set();
  const identity = new Map();
  let previous;
  for (const line of lines) {
    if (line.startsWith("\t")) {
      assert.equal(previous?.severity, "DETAIL", "continuation belongs to DETAIL event");
      assert.match(line, /^\tProcess \d+(?: waits for |: )/);
      continue;
    }
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) UTC \[(\d+)\] (\w+)@(\w+) (LOG|FATAL|ERROR|DETAIL|HINT|STATEMENT):  (.+)$/.exec(line);
    assert.ok(match, "PostgreSQL prefix/verbosity");
    const [, date, time, pid, user, database, severity, message] = match;
    const knownMessages = /^(?:duration: |too many connections for (?:database|role) "\w+"$|sorry, too many clients already$|password authentication failed for user "\w+"$|permission denied for (?:table|schema|function) \w+$|permission denied for database "\w+"$|terminating connection due to administrator command$|could not receive data from client: Connection reset by peer$|cannot execute INSERT in a read-only transaction$|could not extend file "[\w/]+": No space left on device$|duplicate key value violates unique constraint "\w+"$|column "\w+" does not exist$|canceling statement due to (?:statement timeout|user request)$|deadlock detected$)/;
    if (["LOG", "ERROR", "FATAL"].includes(severity)) assert.match(message, knownMessages, "selected engine message conventions");
    assert.ok(!terminated.has(pid), "no activity after FATAL for that session");
    const session = `${user}@${database}`;
    assert.equal(identity.get(pid) ?? session, session);
    identity.set(pid, session);
    if (["DETAIL", "HINT", "STATEMENT"].includes(severity)) {
      assert.equal(previous?.pid, pid, "continuation PID");
      assert.ok(["ERROR", "DETAIL", "HINT"].includes(previous.severity));
    }
    if (severity === "FATAL") terminated.add(pid);
    if (severity === "LOG" && message.startsWith("duration:")) assert.match(message, /^duration: \d+\.\d{3} ms  statement: .+;$/);
    assert.doesNotMatch(message, /^\w{5}: /, "SQLSTATE omitted by selected profile");
    times.push(timestamp(`${date}T${time}Z`));
    previous = { pid, severity };
  }
  ordered(times);
  return times;
}

function mysql(lines) {
  const sessions = new Set();
  const times = lines.map((line) => {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\t([ \d]{5}) (Connect|Query|Quit)\t(.*)$/.exec(line);
    assert.ok(match, "MySQL FILE general record");
    const [, date, thread, command, argument] = match;
    assert.equal(thread, String(Number(thread)).padStart(5, " "));
    if (command === "Connect") {
      assert.ok(!sessions.has(thread));
      assert.match(argument, /^\w+@192\.0\.2\.\d+ on \w+ using SSL\/TLS$/);
      sessions.add(thread);
    } else {
      assert.ok(sessions.has(thread), "query/quit requires connected thread");
      if (command === "Quit") {
        assert.equal(argument, "");
        sessions.delete(thread);
      } else {
        assert.ok(argument.length > 0);
        assert.doesNotMatch(argument, /^SELECT FROM /, "log_raw=OFF suppresses the selected unparseable statement");
      }
    }
    return timestamp(date.replace(/(\.\d{3})\d{3}Z$/, "$1Z"));
  });
  assert.equal(sessions.size, 0, "complete observer session excerpt");
  ordered(times);
  return times;
}

function operations(lines) {
  assert.ok(lines.length >= 2);
  assert.match(lines[0], /environment=(production|staging); window=\d{2}:\d{2}:\d{2}Z\/\d{2}:\d{2}:\d{2}Z; cutoff=/);
  const times = lines.map((line) => {
    const [time, observation, ...extra] = line.split(" | ");
    assert.equal(extra.length, 0);
    assert.ok(observation.length > 0);
    return timestamp(time);
  });
  ordered(times);
  return times;
}

const validators = { "lambda-node22-text": lambda, "node24-client-json": client, "apigw-rest-json": gateway,
  "rds-pg16-stderr": postgres, "rds-mysql80-general": mysql, "operations-v1": operations };

// Independently written reference-shaped examples. New values, selected profiles only.
// Official examples/formatter references and application-defined fields: docs/dataset.md.
const requestId = "aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee";
const fixtures = {
  "lambda-node22-text": [`START RequestId: ${requestId} Version: $LATEST`,
    `2026-10-18T10:00:00.010Z\t${requestId}\tINFO\t{"event":"complete"}`,
    `END RequestId: ${requestId}`,
    `REPORT RequestId: ${requestId}\tDuration: 18.20 ms\tBilled Duration: 19 ms\tMemory Size: 128 MB\tMax Memory Used: 62 MB`],
  "node24-client-json": ['{"time":"2026-10-18T10:00:00.100Z","level":"ERROR","service":"SQS","operation":"SendMessage","event":"error","name":"ECONNRESET","message":"read ECONNRESET"}'],
  "apigw-rest-json": [JSON.stringify({ requestId, extendedRequestId: "abcDEF123=", ip: "192.0.2.8",
    requestTime: "18/Oct/2026:10:00:01 +0000", httpMethod: "GET", resourcePath: "/status", status: "429",
    protocol: "HTTP/1.1", responseLength: "42", responseType: "THROTTLED" })],
  "rds-pg16-stderr": ['2026-10-18 10:00:00.100 UTC [71] worker@appdb ERROR:  permission denied for table orders',
    '2026-10-18 10:00:00.100 UTC [71] worker@appdb STATEMENT:  SELECT * FROM orders;'],
  "rds-mysql80-general": ['2026-10-18T10:00:00.001000Z\t   71 Connect\tobserver@192.0.2.8 on appdb using SSL/TLS',
    '2026-10-18T10:00:00.002000Z\t   71 Query\tSELECT 1', '2026-10-18T10:00:00.003000Z\t   71 Quit\t'],
  "operations-v1": ['2026-10-18T10:00:04.000Z | environment=production; window=09:20:00Z/10:00:04Z; cutoff=2026-10-18T10:00:04.000Z',
    '2026-10-18T10:00:04.000Z | completed customer work=12/12'],
};

test("each documented profile accepts reference-shaped examples and rejects format corruption", () => {
  for (const [profile, lines] of Object.entries(fixtures)) {
    validators[profile](lines);
    const broken = structuredClone(lines);
    broken[0] = "invented AWS log " + broken[0];
    assert.throws(() => validators[profile](broken), undefined, profile);
  }
  assert.throws(() => lambda(fixtures["lambda-node22-text"].map((s) => s.replace("62 MB", "256 MB"))));
  assert.throws(() => lambda(fixtures["lambda-node22-text"].map((s) => s.replace("19 ms", "18 ms"))));
  assert.throws(() => lambda(fixtures["lambda-node22-text"].map((s) => s.replace("END RequestId: a", "END RequestId: b"))));
  assert.throws(() => client(fixtures["node24-client-json"].map((s) => s.replace('"message":', '"httpStatusCode":500,"message":'))));
  assert.throws(() => gateway(fixtures["apigw-rest-json"].map((s) => s.replace('"429"', '"401"'))));
  assert.throws(() => postgres(fixtures["rds-pg16-stderr"].map((s, i) => i ? s.replace("[71]", "[72]") : s)));
  assert.throws(() => mysql(fixtures["rds-mysql80-general"].slice(1)));
  assert.throws(() => client([fixtures["node24-client-json"][0], fixtures["node24-client-json"][0].replace(".100Z", ".010Z")]));
});

test("caller profiles reject plausible JSON with impossible source semantics", () => {
  const valid = { time: "2026-10-18T10:00:00.100Z", level: "ERROR", service: "DynamoDB", operation: "Query",
    event: "error", name: "ProvisionedThroughputExceededException", message: "The configured throughput was exceeded",
    httpStatusCode: 400, requestId: "A".repeat(52) };
  client([JSON.stringify(valid)]);
  for (const mutation of [
    { operation: "DeleteMessage" }, { httpStatusCode: 500 }, { requestId },
    { name: "ConditionalCheckFailedException" }, { service: "SQS" },
  ]) assert.throws(() => client([JSON.stringify({ ...valid, ...mutation })]));
  const sqs = { ...valid, service: "SQS", operation: "DeleteMessage", name: "ReceiptHandleIsInvalid", requestId };
  client([JSON.stringify(sqs)]);
  assert.throws(() => client([JSON.stringify({ ...sqs, name: "KmsThrottled" })]));
  assert.throws(() => client([JSON.stringify({ ...sqs, httpStatusCode: 403 })]));
  const mysqlError = { time: valid.time, level: "ERROR", service: "RDS MySQL", operation: "query", event: "error",
    name: "ER_PARSE_ERROR", message: "You have an error in your SQL syntax" };
  assert.throws(() => client([JSON.stringify(mysqlError)]), /MySQL 8.0.44/);
  assert.throws(() => mysql(fixtures["rds-mysql80-general"].map((s) => s.replace("SELECT 1", "SELECT FROM orders"))), /log_raw/);
});

test("every expanded excerpt matches its profile, event boundaries, correlations, and decision cutoff", () => {
  const profiles = new Set();
  for (const incident of dataset) {
    const note = notes.cases.find(({ id }) => id === incident.id);
    const parsed = sections(incident.description);
    assert.equal(parsed.length, note.excerpts.length, incident.id);
    for (const [index, section] of parsed.entries()) {
      const { profile, source, view } = note.excerpts[index];
      assert.deepEqual({ source: section.source, view: section.view }, { source, view });
      assert.ok(validators[profile], profile);
      const times = validators[profile](section.lines);
      assert.ok(times.every((time) => time <= timestamp(note.decisionCutoff)), incident.id);
      profiles.add(profile);
    }
  }
  assert.deepEqual([...profiles].sort(), Object.keys(validators).sort());
});

test("database continuations and MySQL caller thread/timing relationships remain consistent", () => {
  for (const incident of dataset) {
    const note = notes.cases.find(({ id }) => id === incident.id);
    const parsed = sections(incident.description);
    if (note.source === "RDS MySQL") {
      const native = parsed[0].lines.map((line) => line.split("\t"));
      const call = parsed[1].lines.map(JSON.parse).find(({ name }) => name);
      if (call.connectionId !== undefined) {
        assert.equal(Number(native[0][1].split(" ").filter(Boolean)[0]), call.connectionId);
        assert.ok(Date.parse(native[0][0]) <= Date.parse(call.time));
        assert.ok(Date.parse(call.time) <= Date.parse(native.at(-1)[0]));
        assert.match(native[0][2], /^worker@/);
        if (call.name === "ER_PARSE_ERROR") {
          assert.equal(native.length, 2, "unparseable SQL absent under log_raw=OFF");
          assert.ok(native.every((row) => !row[1].includes("Query")));
        }
        if (call.name === "ER_LOCK_WAIT_TIMEOUT") {
          assert.ok(Date.parse(call.time) - Date.parse(native[1][0]) >= 1000);
        }
      } else assert.match(native[0][2], /^observer@/);
    }
    if (note.scenario === "duplicate-id") {
      assert.ok(parsed[0].lines.some((line) => line.includes('DETAIL:  Key (id)=(7) already exists.')));
    }
    if (note.scenario === "deadlock-repeat") {
      assert.equal(parsed[0].lines.filter((line) => /^\tProcess \d+: UPDATE/.test(line)).length, 2);
      assert.ok(parsed[0].lines.some((line) => line.includes("HINT:  See server log for query details.")));
    }
  }
});

test("dataset identity, opaque IDs, scenario separation, label review, and source/category/attention coverage", () => {
  assert.ok(dataset.length >= 120);
  assert.equal(notes.version, "synthetic-aws-v3");
  assert.equal(notes.count, dataset.length);
  assert.equal(notes.sha256, createHash("sha256").update(contents).digest("hex"));
  assert.equal(new Set(dataset.map(({ id }) => id)).size, dataset.length);
  assert.equal(new Set(notes.cases.map(({ scenario }) => scenario)).size, dataset.length);
  assert.equal(new Set(dataset.map(({ description }) => description)).size, dataset.length);
  assert.deepEqual(notes.cases.map(({ id }) => id), dataset.map(({ id }) => id));
  const familySplits = new Map();
  const coverage = new Map();
  const environments = new Map();
  const lengths = new Map();
  for (const [index, incident] of dataset.entries()) {
    assert.deepEqual(Object.keys(incident).sort(), ["id", "description", "expectedCategory", "expectedRequiresAttention"].sort());
    assert.match(incident.id, /^[a-f\d]{16}$/);
    assert.ok(incident.description.split("\n").length >= 5);
    assert.ok(categories.includes(incident.expectedCategory));
    assert.equal(typeof incident.expectedRequiresAttention, "boolean");
    const note = notes.cases[index];
    assert.equal(note.expectedCategory, incident.expectedCategory);
    assert.equal(note.expectedRequiresAttention, incident.expectedRequiresAttention);
    assert.ok(note.categoryReason.length > 30 && note.attentionReason.length > 30);
    assert.match(note.review, /before provider answers/);
    assert.ok(note.resolution.length > 20);
    assert.ok(["development", "held-out"].includes(note.split));
    assert.ok(["direct", "mixed", "uncertain"].includes(note.difficulty));
    assert.equal(familySplits.get(note.scenarioFamily) ?? note.split, note.split, "family split leakage");
    familySplits.set(note.scenarioFamily, note.split);
    const cells = coverage.get(note.source) ?? new Set();
    cells.add(`${incident.expectedCategory}:${incident.expectedRequiresAttention}`);
    coverage.set(note.source, cells);
    const environmentLabels = environments.get(note.environment) ?? new Set();
    environmentLabels.add(incident.expectedRequiresAttention);
    environments.set(note.environment, environmentLabels);
    const labelLengths = lengths.get(incident.expectedRequiresAttention) ?? [];
    labelLengths.push(incident.description.length);
    lengths.set(incident.expectedRequiresAttention, labelLengths);
    const input = buildIncidentInput({ ...incident, notes: note, scenarioFamily: "DO_NOT_SEND", labelRationale: "DO_NOT_SEND" });
    assert.equal(input, `Incident ID: ${incident.id}\nDescription:\n${incident.description}`);
    assert.doesNotMatch(input, /expectedCategory|expectedRequiresAttention|DO_NOT_SEND|scenarioFamily|categoryReason|attentionReason/);
  }
  assert.equal(coverage.size, 6);
  for (const cells of coverage.values()) assert.equal(cells.size, 8);
  for (const labels of environments.values()) assert.equal(labels.size, 2);
  assert.ok(Math.min(...lengths.get(true)) < Math.max(...lengths.get(false)));
  assert.ok(Math.min(...lengths.get(false)) < Math.max(...lengths.get(true)));
  assert.deepEqual([...new Set(notes.cases.map(({ split }) => split))].sort(), ["development", "held-out"]);
});

test("every mechanism has both attention outcomes and counterparts stay in one split", () => {
  const families = new Map();
  for (const note of notes.cases) {
    const labels = families.get(note.scenarioFamily) ?? new Set();
    labels.add(note.expectedRequiresAttention);
    families.set(note.scenarioFamily, labels);
    if (note.counterpartOf) {
      const original = notes.cases.find(({ scenario }) => scenario === note.counterpartOf);
      assert.equal(note.scenarioFamily, original.scenarioFamily);
      assert.equal(note.split, original.split);
      assert.notEqual(note.expectedRequiresAttention, original.expectedRequiresAttention);
      assert.equal(note.expectedCategory, original.expectedCategory);
    }
  }
  for (const [family, labels] of families) assert.equal(labels.size, 2, family);
  const unknownUrgent = notes.cases.filter((note) => note.scenarioFamily === "unknown-timeout" && note.expectedRequiresAttention);
  assert.ok(unknownUrgent.length > 0);
  assert.ok(unknownUrgent.every(({ expectedCategory }) => expectedCategory === "other"));
  const timestampLabels = new Set(dataset.filter(({ description }) => description.includes("at 09:59"))
    .map(({ expectedRequiresAttention }) => expectedRequiresAttention));
  assert.equal(timestampLabels.size, 2);
  const reports = dataset.flatMap(({ description }) => description.match(/^REPORT.*$/gm) ?? [])
    .map((line) => line.replace(/RequestId: \S+/, "RequestId: <ID>"));
  assert.ok(new Set(reports).size > 10, "duration and memory vary independently of outcomes");
  assert.equal(notes.independentReview.status, "pending");
  assert.equal(notes.independentReview.reviewer, null);
});
