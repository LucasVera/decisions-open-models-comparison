import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main as compareCurrent, validateSavedResult } from "../compare.js";
import { decisionDefinitionHash } from "../evaluation.js";
import { createHash } from "node:crypto";

const compare = (options) => compareCurrent({ dataPath: null, ...options });

const categories = ["throttling", "authentication", "dependency_failure", "other"];
const datasetHash = "a".repeat(64);
const definitionsHash = "b".repeat(64);

async function makeTempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "decision-api-compare-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

function makeEvaluation(provider, { partial = false, count = 12, failed = false } = {}) {
  const incidents = Array.from({ length: count }, (_, index) => {
    const category = categories[index % categories.length];
    const requiresAttention = index % 2 === 0;
    const isPartial = partial && index === 0;
    const decision = {
      category,
      categoryProbabilities: null,
      requiresAttentionProbability: isPartial ? null : requiresAttention ? 1 : 0,
      requiresAttention: isPartial ? null : requiresAttention,
    };
    const isFailed = failed && index === count - 1;
    return {
      id: `incident-${String(index + 1).padStart(2, "0")}`,
      description: `Synthetic incident ${index + 1}.`,
      expected: { category, requiresAttention },
      decision: isFailed ? null : decision,
      correctness: { category: isFailed ? null : true, requiresAttention: isFailed || isPartial ? null : true },
      status: isFailed ? "failed" : isPartial ? "partial" : "complete",
      error: isFailed ? "Mock provider failure." : isPartial ? "Attention probability was unavailable." : null,
      elapsedMs: 10 + index,
      returnedModel: provider === "ollama" ? "d1" : "gpt-6-luna",
    };
  });

  const completedCount = incidents.filter(({ status }) => status === "complete").length;
  const unavailableDecisionCount = incidents.filter(({ status }) => status === "partial").length;
  const attentionCorrectCount = incidents.filter(({ correctness }) => correctness.requiresAttention === true).length;
  const categoryCorrectCount = incidents.filter(({ correctness }) => correctness.category === true).length;
  const requestFailureCount = incidents.filter(({ status }) => status === "failed").length;

  return {
    schemaVersion: 1,
    provider,
    requestedModel: provider === "ollama" ? "d1" : "gpt-6-luna",
    returnedModels: [provider === "ollama" ? "d1" : "gpt-6-luna"],
    runAt: "2026-10-17T00:00:00.000Z",
    dataset: { path: "data/incidents.json", sha256: datasetHash, incidentCount: count },
    decisionDefinitions: { sha256: definitionsHash, attentionThreshold: 0.5 },
    scoring: {
      version: "full-dataset-v1",
      accuracyDenominator: "full_dataset",
      unavailableDecisionsCorrect: false,
      averageLatencyDenominator: "timed_attempts_including_failures",
      latencyUnit: "ms",
    },
    summary: {
      totalCount: count,
      completedCount,
      failedCount: count - completedCount,
      requestFailureCount,
      unavailableDecisionCount,
      categoryAccuracy: { correctCount: categoryCorrectCount, denominator: count, value: categoryCorrectCount / count },
      attentionAccuracy: {
        correctCount: attentionCorrectCount,
        denominator: count,
        value: attentionCorrectCount / count,
      },
      averageLatencyMs: 10 + (count - 1) / 2,
      latencyAttemptCount: count,
    },
    incidents,
  };
}

async function writePair(directory, ollama, openai) {
  const ollamaPath = join(directory, "ollama.json");
  const openaiPath = join(directory, "openai.json");
  await writeFile(ollamaPath, JSON.stringify(ollama));
  await writeFile(openaiPath, JSON.stringify(openai));
  return { ollamaPath, openaiPath };
}

test("comparison reports missing, corrupt, and unsupported result files with their paths", async (t) => {
  const directory = await makeTempDirectory(t);
  const errors = [];
  const missing = await compare({
    ollamaPath: join(directory, "missing-ollama.json"),
    openaiPath: join(directory, "missing-openai.json"),
    errorOutput: (line) => errors.push(line),
  });
  assert.equal(missing.ok, false);
  assert.match(errors.join("\n"), /missing-ollama\.json/);
  assert.match(errors.join("\n"), /MODEL_PROVIDER=ollama/);
  assert.match(errors.join("\n"), /missing-openai\.json/);

  const corruptPath = join(directory, "corrupt-openai.json");
  await writeFile(corruptPath, "{");
  const validOllamaPath = join(directory, "valid-ollama.json");
  await writeFile(validOllamaPath, JSON.stringify(makeEvaluation("ollama")));
  const corruptErrors = [];
  const corrupt = await compare({
    ollamaPath: validOllamaPath,
    openaiPath: corruptPath,
    errorOutput: (line) => corruptErrors.push(line),
  });
  assert.equal(corrupt.ok, false);
  assert.match(corruptErrors.join("\n"), /corrupt-openai\.json.*not valid JSON/);

  const unsupportedPath = join(directory, "unsupported-openai.json");
  await writeFile(unsupportedPath, JSON.stringify({ schemaVersion: 9 }));
  const unsupportedErrors = [];
  const unsupported = await compare({
    ollamaPath: validOllamaPath,
    openaiPath: unsupportedPath,
    errorOutput: (line) => unsupportedErrors.push(line),
  });
  assert.equal(unsupported.ok, false);
  assert.match(unsupportedErrors.join("\n"), /unsupported-openai\.json.*unsupported or missing schemaVersion/);
});

test("saved results reject unsupported shapes and mismatched incident evidence", async (t) => {
  assert.throws(
    () => validateSavedResult({ schemaVersion: 7 }, "fixture.json", "ollama"),
    /unsupported or missing schemaVersion/,
  );

  const directory = await makeTempDirectory(t);
  const ollama = makeEvaluation("ollama");
  const openai = makeEvaluation("openai");
  openai.dataset.sha256 = "c".repeat(64);
  openai.incidents[0].description = "Different evidence.";
  const paths = await writePair(directory, ollama, openai);
  const errors = [];
  const comparison = await compare({ ...paths, errorOutput: (line) => errors.push(line) });

  assert.equal(comparison.ok, false);
  assert.match(errors.join("\n"), /dataset file hashes differ/);
  assert.match(errors.join("\n"), /evidence or expected outcomes differ for incident incident-01/);
  assert.match(errors.join("\n"), /Rerun both evaluations/);
});

test("saved results reject mismatched decision definitions and thresholds", async (t) => {
  const directory = await makeTempDirectory(t);
  const ollama = makeEvaluation("ollama");
  const openai = makeEvaluation("openai");
  openai.decisionDefinitions.sha256 = "d".repeat(64);
  openai.decisionDefinitions.attentionThreshold = 0.6;
  const paths = await writePair(directory, ollama, openai);
  const errors = [];
  const comparison = await compare({ ...paths, errorOutput: (line) => errors.push(line) });

  assert.equal(comparison.ok, false);
  assert.match(errors.join("\n"), /decision definition hashes differ/);
  assert.match(errors.join("\n"), /attention thresholds differ/);
});

test("comparison prints compatible complete results and labels partial evaluations", async (t) => {
  const directory = await makeTempDirectory(t);
  const completePaths = await writePair(directory, makeEvaluation("ollama"), makeEvaluation("openai"));
  const completeOutput = [];
  const complete = await compare({ ...completePaths, output: (line) => completeOutput.push(line) });
  assert.deepEqual(complete, { ok: true, partial: false });
  assert.match(completeOutput.join("\n"), /Ollama \(COMPLETE\)/);
  assert.match(completeOutput.join("\n"), /OpenAI \(COMPLETE\)/);
  assert.match(completeOutput.join("\n"), /15\.50/);

  const partialPaths = await writePair(directory, makeEvaluation("ollama", { partial: true }), makeEvaluation("openai"));
  const partialOutput = [];
  const partial = await compare({ ...partialPaths, output: (line) => partialOutput.push(line) });
  assert.deepEqual(partial, { ok: false, partial: true });
  assert.match(partialOutput.join("\n"), /Ollama \(PARTIAL\)/);
  assert.match(partialOutput.join("\n"), /Rerun it after/);
});

test("comparison without provider configuration only reads the supplied saved files", async (t) => {
  const directory = await makeTempDirectory(t);
  const paths = await writePair(directory, makeEvaluation("ollama"), makeEvaluation("openai"));
  const output = [];
  const result = await compare({ ...paths, output: (line) => output.push(line) });
  assert.equal(result.ok, true);
  assert.match(output.join("\n"), /Saved-result comparison/);
});

test("comparison validates variable sizes, failed rows, and metadata completeness", async (t) => {
  const directory = await makeTempDirectory(t);
  for (const count of [1, 7, 13, 120]) {
    for (const failed of [false, true]) {
      const ollama = makeEvaluation("ollama", { count, failed });
      const openai = makeEvaluation("openai", { count });
      validateSavedResult(ollama, "fixture-ollama.json", "ollama");
      const paths = await writePair(directory, ollama, openai);
      const output = [];
      assert.deepEqual(await compare({ ...paths, output: (line) => output.push(line) }),
        { ok: !failed, partial: failed });
      assert.match(output.join("\n"), new RegExp(`/${count} `));
    }
  }
  for (const count of [0, -1, 1.5, "120", Number.MAX_SAFE_INTEGER + 1]) {
    const value = makeEvaluation("ollama");
    value.dataset.incidentCount = count;
    assert.throws(() => validateSavedResult(value, "fixture.json", "ollama"), /positive safe integer/);
  }
  const truncated = makeEvaluation("ollama", { count: 120 });
  truncated.incidents.pop();
  assert.throws(() => validateSavedResult(truncated, "fixture.json", "ollama"), /exactly the dataset incident count/);
  const duplicate = makeEvaluation("ollama", { count: 120 });
  duplicate.incidents[119].id = duplicate.incidents[0].id;
  assert.throws(() => validateSavedResult(duplicate, "fixture.json", "ollama"), /duplicate incident ID/);
});

test("comparison rejects the old 12-case run against an expanded run", async (t) => {
  const directory = await makeTempDirectory(t);
  const ollama = makeEvaluation("ollama", { count: 12 });
  const openai = makeEvaluation("openai", { count: 120 });
  openai.dataset.sha256 = "c".repeat(64);
  const paths = await writePair(directory, ollama, openai);
  const errors = [];
  assert.deepEqual(await compare({ ...paths, errorOutput: (line) => errors.push(line) }), { ok: false, partial: false });
  assert.match(errors.join("\n"), /dataset file hashes differ/);
  assert.match(errors.join("\n"), /dataset incident counts differ/);
  assert.match(errors.join("\n"), /Rerun both evaluations/);
});

test("saved results accept wrong predictions and reject falsified category scoring", () => {
  const result = makeEvaluation("ollama");
  result.incidents[0].decision.category = "other";
  result.incidents[0].correctness.category = false;
  result.summary.categoryAccuracy = { correctCount: 11, denominator: 12, value: 11 / 12 };
  validateSavedResult(result, "fixture.json", "ollama");
  const wrongFlag = structuredClone(result);
  wrongFlag.incidents[0].correctness.category = true;
  assert.throws(() => validateSavedResult(wrongFlag, "fixture.json", "ollama"), /incorrect category scoring/);
  const wrongSummary = structuredClone(result);
  wrongSummary.summary.categoryAccuracy = { correctCount: 12, denominator: 12, value: 1 };
  assert.throws(() => validateSavedResult(wrongSummary, "fixture.json", "ollama"), /summary.categoryAccuracy/);
});

test("saved results validate complete and partial probability mass without altering values", () => {
  for (const map of [
    { throttling: 0.9, authentication: 0.9, dependency_failure: 0.9, other: 0.9 },
    { throttling: 0.1, authentication: 0.1, dependency_failure: 0.1, other: 0.1 },
    { throttling: 0.8, other: 0.3 },
  ]) {
    const result = makeEvaluation("ollama");
    result.incidents[0].decision.categoryProbabilities = map;
    assert.throws(() => validateSavedResult(result, "fixture.json", "ollama"), /probability.*sum/i);
  }
  for (const map of [{ throttling: 0.2 },
    { throttling: 0.2, authentication: 0.3, dependency_failure: 0.1, other: 0.4000001 }]) {
    const result = makeEvaluation("ollama");
    result.incidents[0].decision.categoryProbabilities = map;
    assert.deepEqual(validateSavedResult(result, "fixture.json", "ollama").incidents[0].decision.categoryProbabilities, map);
  }
});

test("current comparison rejects two mutually compatible stale results and verifies row evidence", async (t) => {
  const directory = await makeTempDirectory(t);
  const ollama = makeEvaluation("ollama", { count: 1 });
  const openai = makeEvaluation("openai", { count: 1 });
  const dataPath = join(directory, "incidents.json");
  const contents = JSON.stringify([{ id: "incident-01", description: "Synthetic incident 1.",
    expectedCategory: "throttling", expectedRequiresAttention: true }]);
  await writeFile(dataPath, contents);
  const paths = await writePair(directory, ollama, openai);
  const errors = [];
  assert.equal((await compareCurrent({ ...paths, dataPath, errorOutput: (line) => errors.push(line) })).ok, false);
  assert.match(errors.join("\n"), /stale for the current dataset/);
  for (const result of [ollama, openai]) {
    result.dataset.sha256 = createHash("sha256").update(contents).digest("hex");
    result.decisionDefinitions.sha256 = decisionDefinitionHash();
  }
  await writePair(directory, ollama, openai);
  assert.equal((await compareCurrent({ ...paths, dataPath, output: () => {} })).ok, true);
  for (const result of [ollama, openai]) result.decisionDefinitions.attentionThreshold = 0.6;
  await writePair(directory, ollama, openai);
  assert.equal((await compareCurrent({ ...paths, dataPath, output: () => {}, errorOutput: () => {} })).ok, false);
  for (const result of [ollama, openai]) result.decisionDefinitions.attentionThreshold = 0.5;
  for (const result of [ollama, openai]) result.incidents[0].description = "Forged matching metadata.";
  await writePair(directory, ollama, openai);
  assert.equal((await compareCurrent({ ...paths, dataPath, output: () => {}, errorOutput: () => {} })).ok, false);
});
