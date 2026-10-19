import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ATTENTION_QUESTION, CATEGORY_QUESTION, buildIncidentInput } from "../decisions.js";
import { requestOllamaDecision } from "../providers/ollama.js";
import { requestOpenAIDecision } from "../providers/openai.js";
import { DATASET_PATH, runEvaluation } from "../evaluation.js";
import { main as compare, validateSavedResult } from "../compare.js";

const incident = {
  id: "shared-input-check",
  description: "A synthetic production incident with evidence for both decisions.",
  expectedCategory: "dependency_failure",
  expectedRequiresAttention: true,
};

function response(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("both providers receive identical incident evidence without expected labels", async () => {
  const inputs = {};
  await requestOllamaDecision({
    incident,
    model: "d1",
    baseUrl: "http://localhost:11434",
    fetchImpl: async (_url, options) => {
      inputs.ollama = JSON.parse(options.body).state;
      return response({
        answers: {
          [CATEGORY_QUESTION.name]: { type: "choice", choice: "dependency_failure" },
          [ATTENTION_QUESTION.name]: { type: "noul", noul: 0.8 },
        },
      });
    },
  });

  await requestOpenAIDecision({
    incident,
    model: "gpt-6-luna",
    apiKey: "sk-test-shared-input-key",
    fetchImpl: async (_url, options) => {
      inputs.openai = JSON.parse(options.body).input;
      return response({
        answers: [
          {
            type: "choice",
            name: CATEGORY_QUESTION.name,
            choice: "dependency_failure",
          },
          {
            type: "predicate",
            name: ATTENTION_QUESTION.name,
            probability: 0.8,
          },
        ],
      });
    },
  });

  assert.equal(inputs.ollama, buildIncidentInput(incident));
  assert.equal(inputs.openai, buildIncidentInput(incident));
  assert.equal(inputs.ollama, inputs.openai);
  assert.equal(inputs.openai.includes("expectedCategory"), false);
  assert.equal(inputs.openai.includes("expectedRequiresAttention"), false);
});

test("both adapters reject impossible category probability totals", async () => {
  const map = { throttling: 0.9, authentication: 0.9, dependency_failure: 0.9, other: 0.9 };
  await assert.rejects(requestOllamaDecision({ incident, model: "d1", baseUrl: "http://localhost:11434",
    fetchImpl: async () => response({ answers: {
      category: { type: "choice", choice: "other", probabilities: map },
      requires_attention: { type: "noul", noul: 0.5 },
    } }) }), /probability.*sum/i);
  await assert.rejects(requestOpenAIDecision({ incident, model: "gpt-6-luna", apiKey: "sk-fixture-only",
    fetchImpl: async () => response({ answers: [
      { type: "choice", name: "category", choice: "other", probabilities: Object.entries(map).map(([value, probability]) => ({ value, probability })) },
      { type: "predicate", name: "requires_attention", probability: 0.5 },
    ] }) }), /probability.*sum/i);
});

test("both adapters evaluate all expanded incidents once in order with identical untruncated requests", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "decision-api-expanded-fixture-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"));
  const inputs = {};
  for (const provider of ["ollama", "openai"]) {
    inputs[provider] = [];
    let active = 0;
    let maxActive = 0;
    const config = provider === "ollama"
      ? { provider, model: "d1", baseUrl: "http://localhost:11434" }
      : { provider, model: "gpt-6-luna", apiKey: "sk-expanded-fixture-only" };
    const request = provider === "ollama" ? requestOllamaDecision : requestOpenAIDecision;
    const { result, hasFailures } = await runEvaluation({
      config, resultsDirectory: directory, output: () => {},
      requestDecision: async (incident, hooks) => request({
        ...config, incident, onResponseMetadata: hooks.onResponseMetadata,
        fetchImpl: async (url, options) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setImmediate(resolve));
          const payload = JSON.parse(options.body);
          const index = inputs[provider].length;
          const expected = dataset[index];
          assert.equal(incident.id, expected.id);
          const input = provider === "ollama" ? payload.state : payload.input;
          assert.equal(input, buildIncidentInput(expected));
          assert.ok(input.endsWith(expected.description));
          assert.equal(input.split("\n").length, expected.description.split("\n").length + 2);
          assert.doesNotMatch(input, /expectedCategory|expectedRequiresAttention|scenarioFamily|categoryReason|attentionReason/);
          inputs[provider].push(input);
          if (provider === "ollama") {
            assert.ok(url.endsWith("/v1/systemone"));
            assert.equal(Object.keys(payload.questions).length, 2);
          } else {
            assert.equal(url, "https://api.openai.com/v1/decisions");
            assert.equal(payload.questions.length, 2);
          }
          const probability = expected.expectedRequiresAttention ? 0.5 : 0.1254321;
          active -= 1;
          return response(provider === "ollama" ? {
            answers: {
              category: { type: "choice", choice: expected.expectedCategory },
              requires_attention: { type: "noul", noul: probability },
            },
          } : {
            answers: [
              { type: "predicate", name: "requires_attention", probability },
              { type: "choice", name: "category", choice: expected.expectedCategory },
            ],
          });
        },
      }),
    });
    assert.equal(hasFailures, false);
    assert.equal(maxActive, 1);
    assert.equal(inputs[provider].length, dataset.length);
    assert.equal(new Set(result.incidents.map(({ id }) => id)).size, dataset.length);
    assert.deepEqual(result.incidents.map(({ id }) => id), dataset.map(({ id }) => id));
    assert.equal(result.summary.completedCount, dataset.length);
    validateSavedResult(result, `${provider}-fixture.json`, provider);
  }
  assert.deepEqual(inputs.ollama, inputs.openai);
  assert.deepEqual(await compare({
    ollamaPath: join(directory, "ollama.json"), openaiPath: join(directory, "openai.json"), output: () => {},
  }), { ok: true, partial: false });
});
