import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_QUESTION, CATEGORY_QUESTION } from "../decisions.js";
import { requestOllamaDecision } from "../providers/ollama.js";

const incident = {
  id: "lambda-concurrency-exhaustion",
  description: "Production Lambda requests are throttled and customers are affected.",
  expectedCategory: "throttling",
  expectedRequiresAttention: true,
};

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    },
  };
}

test("Ollama adapter sends shared questions and maps named answers", async () => {
  let request;
  const result = await requestOllamaDecision({
    incident,
    model: "d1",
    baseUrl: "http://localhost:11434/",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
        model: "d1",
        answers: {
          [CATEGORY_QUESTION.name]: {
            type: "choice",
            choice: "throttling",
            probabilities: {
              throttling: 0.812345,
              authentication: 0.061,
              dependency_failure: 0.096655,
              other: 0.03,
            },
            confidence: 0.812345,
          },
          [ATTENTION_QUESTION.name]: { type: "noul", noul: 0.5 },
        },
      });
    },
  });

  assert.equal(request.url, "http://localhost:11434/v1/systemone");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["content-type"], "application/json");
  assert.ok(request.options.signal instanceof AbortSignal);

  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "d1");
  assert.equal(
    body.state,
    "Incident ID: lambda-concurrency-exhaustion\nDescription:\nProduction Lambda requests are throttled and customers are affected.",
  );
  assert.equal(body.state.includes("expectedCategory"), false);
  assert.deepEqual(
    body.questions[CATEGORY_QUESTION.name].criteria,
    Object.fromEntries(CATEGORY_QUESTION.options.map(({ value, description }) => [value, description])),
  );
  assert.equal(body.questions[CATEGORY_QUESTION.name].type, "choice");
  assert.equal(body.questions[ATTENTION_QUESTION.name].type, "noul");
  assert.deepEqual(body.questions[ATTENTION_QUESTION.name].criteria, ATTENTION_QUESTION.criteria);
  assert.match(body.questions[CATEGORY_QUESTION.name].instructions, new RegExp(CATEGORY_QUESTION.question));
  assert.match(body.questions[ATTENTION_QUESTION.name].instructions, new RegExp(ATTENTION_QUESTION.question));
  assert.deepEqual(result, {
    category: "throttling",
    categoryProbabilities: {
      throttling: 0.812345,
      authentication: 0.061,
      dependency_failure: 0.096655,
      other: 0.03,
    },
    requiresAttentionProbability: 0.5,
    requiresAttention: true,
  });
});

test("Ollama marks omitted probabilities unavailable and rejects invalid values", async () => {
  const args = { incident, model: "d1", baseUrl: "http://localhost:11434" };
  const partial = await requestOllamaDecision({
    ...args,
    fetchImpl: async () => response({
      answers: {
        [CATEGORY_QUESTION.name]: {
          type: "choice",
          choice: "throttling",
          probabilities: { throttling: 0.314159265 },
        },
        [ATTENTION_QUESTION.name]: { type: "noul" },
      },
    }),
  });

  assert.deepEqual(partial, {
    category: "throttling",
    categoryProbabilities: { throttling: 0.314159265 },
    requiresAttentionProbability: null,
    requiresAttention: null,
  });

  await assert.rejects(
    requestOllamaDecision({
      ...args,
      fetchImpl: async () => response({
        answers: {
          [CATEGORY_QUESTION.name]: {
            type: "choice",
            choice: "throttling",
            probabilities: { throttling: "0.8" },
          },
          [ATTENTION_QUESTION.name]: { type: "noul", noul: 0.5 },
        },
      }),
    }),
    /invalid decision/,
  );
});

test("Ollama adapter reports connection, timeout, HTTP, JSON, and answer errors", async (t) => {
  const args = { incident, model: "d1", baseUrl: "http://localhost:11434" };

  await t.test("connection failure", async () => {
    await assert.rejects(
      requestOllamaDecision({ ...args, fetchImpl: async () => { throw new Error("offline"); } }),
      /Could not connect to Ollama/,
    );
  });

  await t.test("timeout", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    await assert.rejects(
      requestOllamaDecision({ ...args, fetchImpl: async () => { throw timeout; }, timeoutMs: 25 }),
      /timed out after 25 ms/,
    );
  });

  await t.test("missing model or endpoint", async () => {
    await assert.rejects(
      requestOllamaDecision({ ...args, fetchImpl: async () => response("not found", 404) }),
      /model is installed and this server supports \/v1\/systemone/,
    );
  });

  await t.test("invalid JSON", async () => {
    await assert.rejects(
      requestOllamaDecision({ ...args, fetchImpl: async () => response("{" ) }),
      /invalid JSON from \/v1\/systemone/,
    );
  });

  await t.test("invalid answers", async () => {
    await assert.rejects(
      requestOllamaDecision({ ...args, fetchImpl: async () => response({ answers: {} }) }),
      /missing a required named answer/,
    );
  });
});
