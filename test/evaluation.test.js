import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DATASET_PATH, runEvaluation } from "../evaluation.js";

const apiKey = "sk-test-evaluation-key";

async function makeTempDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "decision-api-task11-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("the synthetic dataset has at least 120 unique incidents and coverage for each label", async () => {
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  assert.ok(dataset.length >= 120);
  assert.equal(new Set(dataset.map(({ id }) => id)).size, dataset.length);

  const coverage = new Map();
  for (const incident of dataset) {
    assert.equal(typeof incident.id, "string");
    assert.ok(incident.description.trim().length > 0);
    assert.equal(typeof incident.expectedRequiresAttention, "boolean");
    const labels = coverage.get(incident.expectedCategory) ?? new Set();
    labels.add(incident.expectedRequiresAttention);
    coverage.set(incident.expectedCategory, labels);
  }

  assert.deepEqual([...coverage.keys()].sort(), [
    "authentication",
    "dependency_failure",
    "other",
    "throttling",
  ]);
  for (const outcomes of coverage.values()) {
    assert.deepEqual([...outcomes].sort(), [false, true]);
  }
});

test("evaluation validates the dataset before making any provider request", async (t) => {
  const directory = await makeTempDirectory(t);
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  dataset[1].id = dataset[0].id;
  const dataPath = join(directory, "invalid-incidents.json");
  await writeFile(dataPath, JSON.stringify(dataset));

  let requestCount = 0;
  await assert.rejects(
    runEvaluation({
      config: { provider: "ollama", model: "d1", baseUrl: "http://localhost:11434" },
      dataPath,
      resultsDirectory: join(directory, "results"),
      requestDecision: async () => { requestCount += 1; },
      output: () => {},
    }),
    /duplicate incident ID/,
  );
  assert.equal(requestCount, 0);
});

test("evaluation runs sequentially, scores unavailable rows against all incidents, and saves the selected provider file", async (t) => {
  const directory = await makeTempDirectory(t);
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  const requestOrder = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let clock = 0;
  const output = [];

  const outcome = await runEvaluation({
    config: { provider: "openai", model: "gpt-6-luna", apiKey },
    dataPath: DATASET_PATH,
    resultsDirectory: join(directory, "results"),
    output: (line) => output.push(line),
    now: () => (clock += 5),
    runTime: () => new Date("2026-10-17T00:00:00.000Z"),
    requestDecision: async (incident, hooks) => {
      requestOrder.push(incident.id);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setImmediate(resolve));
      activeRequests -= 1;

      if (incident.id === dataset[0].id) {
        throw new Error(`provider failure included ${apiKey}`);
      }

      hooks.onResponseMetadata({ model: "gpt-6-luna" });
      if (incident.id === dataset[1].id) {
        return {
          category: incident.expectedCategory,
          categoryProbabilities: { [incident.expectedCategory]: 0.87654321 },
          requiresAttentionProbability: null,
          requiresAttention: null,
        };
      }

      const requiresAttention = incident.id === dataset[2].id
        ? !incident.expectedRequiresAttention
        : incident.expectedRequiresAttention;
      const probability = requiresAttention ? 0.8754321 : 0.1245679;
      return {
        category: incident.expectedCategory,
        categoryProbabilities: { [incident.expectedCategory]: 0.87654321 },
        requiresAttentionProbability: probability,
        requiresAttention,
      };
    },
  });

  assert.deepEqual(requestOrder, dataset.map(({ id }) => id));
  assert.equal(maxActiveRequests, 1);
  assert.equal(outcome.outputPath, join(directory, "results", "openai.json"));
  assert.equal(outcome.hasFailures, true);
  const count = dataset.length;
  assert.equal(outcome.result.incidents.length, count);
  assert.equal(outcome.result.incidents[0].status, "failed");
  assert.equal(outcome.result.incidents[0].error.includes(apiKey), false);
  assert.equal(outcome.result.incidents[1].status, "partial");
  assert.equal(outcome.result.incidents[1].decision.requiresAttention, null);
  assert.deepEqual(outcome.result.summary, {
    totalCount: count,
    completedCount: count - 2,
    failedCount: 2,
    requestFailureCount: 1,
    unavailableDecisionCount: 1,
    categoryAccuracy: { correctCount: count - 1, denominator: count, value: (count - 1) / count },
    attentionAccuracy: { correctCount: count - 3, denominator: count, value: (count - 3) / count },
    averageLatencyMs: 5,
    latencyAttemptCount: count,
  });
  assert.equal(outcome.result.incidents[1].decision.categoryProbabilities[dataset[1].expectedCategory], 0.87654321);
  assert.equal(output.join("\n").includes(apiKey), false);

  const saved = await readFile(outcome.outputPath, "utf8");
  assert.equal(saved.includes(apiKey), false);
  assert.deepEqual(JSON.parse(saved), outcome.result);
});

test("evaluation uses an Ollama result filename when that provider is selected", async (t) => {
  const directory = await makeTempDirectory(t);
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  const outcome = await runEvaluation({
    config: { provider: "ollama", model: "d1", baseUrl: "http://localhost:11434" },
    dataPath: DATASET_PATH,
    resultsDirectory: join(directory, "results"),
    output: () => {},
    requestDecision: async (incident) => ({
      category: incident.expectedCategory,
      categoryProbabilities: null,
      requiresAttentionProbability: incident.expectedRequiresAttention ? 1 : 0,
      requiresAttention: incident.expectedRequiresAttention,
    }),
  });

  assert.equal(outcome.outputPath, join(directory, "results", "ollama.json"));
  assert.equal(outcome.result.summary.completedCount, dataset.length);
  assert.equal(outcome.result.summary.failedCount, 0);
});

test("evaluation accepts variable nonempty sizes and keeps failures in every denominator", async (t) => {
  const directory = await makeTempDirectory(t);
  const source = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  for (const count of [1, 7, 13, source.length]) {
    const dataset = source.slice(0, count);
    const dataPath = join(directory, `incidents-${count}.json`);
    await writeFile(dataPath, JSON.stringify(dataset));
    const order = [];
    const output = [];
    const { result, hasFailures } = await runEvaluation({
      config: { provider: "ollama", model: "d1", baseUrl: "http://localhost:11434" },
      dataPath, resultsDirectory: join(directory, `results-${count}`),
      output: (line) => output.push(line), now: () => 10,
      requestDecision: async (incident) => {
        order.push(incident.id);
        if (incident === undefined || incident.id === dataset.at(-1).id) throw new Error("Fixture failure.");
        return { category: incident.expectedCategory, categoryProbabilities: null,
          requiresAttentionProbability: incident.expectedRequiresAttention ? 0.5 : 0.1,
          requiresAttention: incident.expectedRequiresAttention };
      },
    });
    assert.equal(hasFailures, true);
    assert.deepEqual(order, dataset.map(({ id }) => id));
    assert.equal(result.dataset.incidentCount, count);
    assert.equal(result.summary.failedCount, 1);
    assert.equal(result.summary.completedCount, count - 1);
    assert.equal(result.summary.categoryAccuracy.value, (count - 1) / count);
    assert.equal(result.summary.attentionAccuracy.denominator, count);
    assert.equal(result.summary.latencyAttemptCount, count);
    assert.ok(output.includes(`[${count}/${count}] ${dataset.at(-1).id}`));
  }
});

test("empty and malformed datasets fail before provider requests", async (t) => {
  const directory = await makeTempDirectory(t);
  let requests = 0;
  for (const dataset of [[], {}, null, [null], [{ id: "x", description: "" }]]) {
    const dataPath = join(directory, "invalid.json");
    await writeFile(dataPath, JSON.stringify(dataset));
    await assert.rejects(runEvaluation({
      config: { provider: "ollama", model: "d1", baseUrl: "http://localhost:11434" },
      dataPath, resultsDirectory: directory, output: () => {},
      requestDecision: async () => { requests += 1; },
    }), /Dataset validation failed/);
  }
  assert.equal(requests, 0);
});

test("wrong categories and invalid probability mass remain visible in saved full-dataset scores", async (t) => {
  const directory = await makeTempDirectory(t);
  const dataPath = join(directory, "scoring.json");
  await writeFile(dataPath, JSON.stringify(["wrong", "partial", "invalid"].map((id) => ({
    id, description: "Synthetic evidence.", expectedCategory: "throttling", expectedRequiresAttention: false,
  }))));
  const { result, outputPath, hasFailures } = await runEvaluation({
    config: { provider: "ollama", model: "d1", baseUrl: "http://localhost:11434" },
    dataPath, resultsDirectory: directory, output: () => {},
    requestDecision: async ({ id }) => ({
      category: "other",
      categoryProbabilities: id === "invalid"
        ? { throttling: 0.9, authentication: 0.9, dependency_failure: 0.9, other: 0.9 } : { other: 0.8 },
      requiresAttentionProbability: id === "partial" ? null : 0.1,
      requiresAttention: id === "partial" ? null : false,
    }),
  });
  assert.equal(hasFailures, true);
  assert.deepEqual(result.incidents.map(({ status }) => status), ["complete", "partial", "failed"]);
  assert.deepEqual(result.incidents.map(({ correctness }) => correctness.category), [false, false, null]);
  assert.match(result.incidents[2].error, /probability.*sum/i);
  assert.deepEqual(result.summary.categoryAccuracy, { correctCount: 0, denominator: 3, value: 0 });
  assert.deepEqual(result.summary.attentionAccuracy, { correctCount: 1, denominator: 3, value: 1 / 3 });
  assert.equal(result.summary.failedCount, 2);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), result);
});
