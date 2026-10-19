import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { DATASET_PATH } from "../evaluation.js";
import { ATTENTION_QUESTION, CATEGORY_QUESTION, buildIncidentInput } from "../decisions.js";
import { OLLAMA_MODEL_CATALOG, parseOllamaModels } from "../ollama-models.js";
import { checkOllamaModel, compareOllamaSuite, runOllamaSuite } from "../ollama-suite.js";
import { requestOllamaDecision } from "../providers/ollama.js";

const config = { provider: "ollama", model: "d1", baseUrl: "http://localhost:11434" };
const metadata = { capabilities: ["decision"], details: { format: "gguf", runner: "llamacpp" } };
const decision = { category: "other", categoryProbabilities: { other: 0.812345678901 },
  requiresAttentionProbability: 0.5, requiresAttention: true };
const quiet = () => {};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "ollama-model-suite-"));
  assert.equal(dirname(directory), resolve(tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rows = JSON.parse(await readFile(DATASET_PATH, "utf8")).slice(0, 2);
  const dataPath = join(directory, "incidents.json");
  await writeFile(dataPath, JSON.stringify(rows));
  return { directory, dataPath, rows };
}

test("model selection includes every published decision family, with distinct sizes and custom tags", () => {
  const models = parseOllamaModels("all");
  for (const family of ["d1", "tev1", "nimble", "nimble-v3", "laya", "clef", "clef-flash", "pplx-decider", "kev", "strands-decider"]) {
    assert.ok(models.some((name) => name.split(":")[0] === family), family);
  }
  assert.ok(models.includes("tev1:0.8b") && models.includes("tev1:4b"));
  for (const size of ["0.8b", "4b", "9b", "27b"]) assert.ok(models.some((name) => name.startsWith(`kev:${size}-`)));
  assert.equal(models.length, new Set(models).size);
  assert.deepEqual(parseOllamaModels(" vendor/custom:q4,d1,vendor/custom:q4 "), ["vendor/custom:q4", "d1"]);
  for (const invalid of ["", ",d1", "d1,", "all,d1", "two names"]) {
    assert.throws(() => parseOllamaModels(invalid), /OLLAMA_EVAL_MODELS/);
  }
});

test("model inspection rejects missing and ordinary generation models without inference or response-body disclosure", async () => {
  const calls = [];
  const inspect = (payload, status = 200) => async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(payload), { status });
  };
  assert.deepEqual(await checkOllamaModel("d1", config.baseUrl, inspect(metadata)), metadata);
  await assert.rejects(checkOllamaModel("missing", config.baseUrl, inspect({ error: "private" }, 404)), /ollama pull missing/);
  await assert.rejects(checkOllamaModel("qwen", config.baseUrl, inspect({ capabilities: ["completion"] })), /decision capability/);
  await assert.rejects(checkOllamaModel("d1", config.baseUrl, inspect({ error: "private" }, 500)), (error) => {
    assert.match(error.message, /HTTP 500/);
    return !error.message.includes("private");
  });
  await assert.rejects(checkOllamaModel("d1", config.baseUrl, async () => new Response("private-invalid-json")), (error) => {
    assert.match(error.message, /unreadable JSON/);
    return !error.message.includes("private-invalid-json");
  });
  await assert.rejects(checkOllamaModel("d1", config.baseUrl, async () => { throw new Error("private transport details"); }), /Could not connect/);
  await assert.rejects(checkOllamaModel("d1", config.baseUrl, async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  }), /timed out/);
  assert.ok(calls.every(({ url }) => url.endsWith("/api/show")));
  assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal));
});

test("every catalog model uses identical complete dataset evidence and two questions in sequential order", async (t) => {
  const { directory } = await fixture(t);
  const rows = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  const order = [];
  let sharedQuestions;
  let active = 0;
  let peak = 0;
  const outcome = await runOllamaSuite({
    config, models: parseOllamaModels("all"), resultsDirectory: directory, output: quiet,
    checkModel: async () => metadata,
    requestDecisionForModel: (model) => (incident, hooks) => requestOllamaDecision({
      incident, model, baseUrl: config.baseUrl, onResponseMetadata: hooks.onResponseMetadata,
      fetchImpl: async (url, options) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((done) => setImmediate(done));
        const payload = JSON.parse(options.body);
        sharedQuestions ??= payload.questions;
        assert.deepEqual(payload.questions, sharedQuestions);
        assert.equal(url, `${config.baseUrl}/v1/systemone`);
        assert.equal(payload.model, model);
        assert.equal(payload.state, buildIncidentInput(incident));
        assert.deepEqual(Object.keys(payload.questions), [CATEGORY_QUESTION.name, ATTENTION_QUESTION.name]);
        assert.equal(payload.questions[CATEGORY_QUESTION.name].type, "choice");
        assert.equal(payload.questions[ATTENTION_QUESTION.name].type, "noul");
        assert.equal(payload.state.includes("expectedCategory"), false);
        assert.equal(payload.state.includes("scenarioFamily"), false);
        order.push(`${model}/${incident.id}`);
        active -= 1;
        return new Response(JSON.stringify({ model, answers: {
          [CATEGORY_QUESTION.name]: { type: "choice", choice: "other", probabilities: decision.categoryProbabilities },
          [ATTENTION_QUESTION.name]: { type: "noul", noul: 0.5 },
        } }));
      },
    }),
  });
  assert.equal(peak, 1);
  assert.deepEqual(order, OLLAMA_MODEL_CATALOG.flatMap(({ model }) => rows.map(({ id }) => `${model}/${id}`)));
  assert.equal(outcome.hasFailures, false);
  const comparison = await compareOllamaSuite({ manifestPath: outcome.manifestPath, output: quiet });
  assert.equal(comparison.ok, true);
  for (const result of comparison.results) {
    assert.equal(result.incidents.length, rows.length);
    assert.equal(result.incidents[0].decision.categoryProbabilities.other, 0.812345678901);
    assert.equal(result.incidents[0].decision.requiresAttention, true);
  }
  assert.equal(Object.keys(comparison.analyses).length, OLLAMA_MODEL_CATALOG.length);
});

test("suite results isolate colliding model labels, repeated runs, and existing provider measurements", async (t) => {
  const { directory, dataPath } = await fixture(t);
  await writeFile(join(directory, "ollama.json"), "existing d1 measurement");
  await writeFile(join(directory, "openai.json"), "existing OpenAI measurement");
  const options = { config, models: ["vendor/a:b", "vendor_a:b"], dataPath, resultsDirectory: directory,
    output: quiet, checkModel: async () => metadata, requestDecisionForModel: () => async () => decision };
  const first = await runOllamaSuite(options);
  const second = await runOllamaSuite(options);
  const paths = [...first.manifest.models, ...second.manifest.models].map(({ path }) => path);
  assert.equal(new Set(paths).size, 4);
  assert.equal(await readFile(join(directory, "ollama.json"), "utf8"), "existing d1 measurement");
  assert.equal(await readFile(join(directory, "openai.json"), "utf8"), "existing OpenAI measurement");
  assert.equal((await compareOllamaSuite({ manifestPath: first.manifestPath, dataPath, output: quiet })).ok, true);
  assert.equal((await compareOllamaSuite({ manifestPath: second.latestPath, dataPath, output: quiet })).ok, true);
});

test("missing models and per-incident failures stay visible while later models finish", async (t) => {
  const { directory, dataPath, rows } = await fixture(t);
  const requests = [];
  const outcome = await runOllamaSuite({
    config, models: ["missing", "broken", "d1"], dataPath, resultsDirectory: directory, output: quiet,
    checkModel: async (model) => {
      if (model === "missing") throw new Error("Not installed");
      return metadata;
    },
    requestDecisionForModel: (model) => async (incident) => {
      requests.push([model, incident.id]);
      if (model === "broken" && incident.id === rows[0].id) throw new Error("Runner failure");
      return decision;
    },
  });
  assert.equal(outcome.hasFailures, true);
  assert.deepEqual(outcome.manifest.models.map(({ status }) => status), ["unavailable", "partial", "complete"]);
  assert.equal(requests.length, rows.length * 2);
  const lines = [];
  const comparison = await compareOllamaSuite({ manifestPath: outcome.manifestPath, dataPath, output: (line) => lines.push(line) });
  assert.equal(comparison.ok, false);
  assert.equal(comparison.results[0].summary.categoryAccuracy.denominator, rows.length);
  assert.equal(comparison.results[0].summary.requestFailureCount, 1);
  assert.match(lines.join("\n"), /missing: UNAVAILABLE; no measured accuracy or latency/);
  assert.match(lines.join("\n"), /INCOMPLETE/);
});

test("suite snapshots evidence and validates it before model inspection", async (t) => {
  const { directory, dataPath, rows } = await fixture(t);
  const evidence = [];
  const outcome = await runOllamaSuite({
    config, models: ["d1", "tev1:4b"], dataPath, resultsDirectory: directory, output: quiet,
    checkModel: async () => {
      await writeFile(dataPath, "[]");
      return metadata;
    },
    requestDecisionForModel: () => async (incident) => {
      evidence.push(incident.description);
      return decision;
    },
  });
  assert.equal(outcome.hasFailures, false);
  assert.deepEqual(evidence, [...rows, ...rows].map(({ description }) => description));
  let checks = 0;
  await assert.rejects(runOllamaSuite({ config, models: ["d1"], dataPath, resultsDirectory: directory,
    checkModel: async () => { checks += 1; } }), /nonempty/);
  assert.equal(checks, 0);
});

test("offline suite comparison rejects stale evidence, edited model identity, duplicates, and unfinished manifests", async (t) => {
  const { directory, dataPath } = await fixture(t);
  const outcome = await runOllamaSuite({ config, models: ["d1"], dataPath, resultsDirectory: directory,
    output: quiet, checkModel: async () => metadata, requestDecisionForModel: () => async () => decision });
  const original = JSON.parse(await readFile(outcome.manifestPath, "utf8"));
  const edited = structuredClone(original);
  edited.dataset.sha256 = "a".repeat(64);
  await writeFile(outcome.manifestPath, JSON.stringify(edited));
  await assert.rejects(compareOllamaSuite({ manifestPath: outcome.manifestPath, dataPath, output: quiet }), /stale/);
  await writeFile(outcome.manifestPath, JSON.stringify({ ...original, models: [...original.models, ...original.models] }));
  await assert.rejects(compareOllamaSuite({ manifestPath: outcome.manifestPath, dataPath, output: quiet }), /duplicate/);
  await writeFile(outcome.manifestPath, JSON.stringify({ ...original, selectedModels: ["d1", "tev1:4b"], status: "running" }));
  assert.equal((await compareOllamaSuite({ manifestPath: outcome.manifestPath, dataPath, output: quiet })).ok, false);
  await writeFile(outcome.manifestPath, JSON.stringify(original));
  const resultPath = resolve(dirname(outcome.manifestPath), original.models[0].path);
  const saved = JSON.parse(await readFile(resultPath, "utf8"));
  saved.requestedModel = "different";
  await writeFile(resultPath, JSON.stringify(saved));
  await assert.rejects(compareOllamaSuite({ manifestPath: outcome.manifestPath, dataPath, output: quiet }), /saved model differs/);
});
