import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_QUESTION,
  buildIncidentInput,
  CATEGORY_QUESTION,
} from "../decisions.js";
import {
  OPENAI_DECISIONS_URL,
  requestOpenAIDecision,
} from "../providers/openai.js";

const apiKey = "sk-test-do-not-print";
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

test("OpenAI adapter sends shared questions and maps answers by name", async () => {
  let request;
  const result = await requestOpenAIDecision({
    incident,
    model: "gpt-6-luna",
    apiKey,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
        model: "gpt-6-luna",
        answers: [
          {
            type: "predicate",
            name: ATTENTION_QUESTION.name,
            probability: 0.5,
          },
          {
            type: "choice",
            name: CATEGORY_QUESTION.name,
            choice: "throttling",
            probabilities: [
              { value: "other", probability: 0.03 },
              { value: "throttling", probability: 0.812345 },
            ],
            confidence: 0.99,
          },
        ],
      });
    },
  });

  assert.equal(request.url, OPENAI_DECISIONS_URL);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, `Bearer ${apiKey}`);
  assert.equal(request.options.headers["content-type"], "application/json");
  assert.ok(request.options.signal instanceof AbortSignal);

  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.input, buildIncidentInput(incident));
  assert.equal(body.input.includes("expectedCategory"), false);
  assert.equal(body.input.includes("expectedRequiresAttention"), false);
  assert.deepEqual(
    body.questions[0],
    {
      type: "choice",
      name: CATEGORY_QUESTION.name,
      instructions: `${CATEGORY_QUESTION.question}\n${CATEGORY_QUESTION.instructions}`,
      choices: CATEGORY_QUESTION.options.map(({ value, description }) => ({
        value,
        description,
      })),
    },
  );
  assert.deepEqual(body.questions[1], {
    type: "predicate",
    name: ATTENTION_QUESTION.name,
    instructions: [
      ATTENTION_QUESTION.question,
      ATTENTION_QUESTION.instructions,
      `True: ${ATTENTION_QUESTION.criteria.true}`,
      `False: ${ATTENTION_QUESTION.criteria.false}`,
    ].join("\n"),
  });
  assert.deepEqual(result, {
    category: "throttling",
    categoryProbabilities: {
      other: 0.03,
      throttling: 0.812345,
    },
    requiresAttentionProbability: 0.5,
    requiresAttention: true,
  });
});

test("OpenAI marks omitted probabilities unavailable and rejects invalid values", async () => {
  const args = { incident, model: "gpt-6-luna", apiKey };
  const partial = await requestOpenAIDecision({
    ...args,
    fetchImpl: async () => response({
      answers: [
        {
          type: "choice",
          name: CATEGORY_QUESTION.name,
          choice: "throttling",
          probabilities: [{ value: "throttling", probability: 0.314159265 }],
        },
        { type: "predicate", name: ATTENTION_QUESTION.name },
      ],
    }),
  });

  assert.deepEqual(partial, {
    category: "throttling",
    categoryProbabilities: { throttling: 0.314159265 },
    requiresAttentionProbability: null,
    requiresAttention: null,
  });

  await assert.rejects(
    requestOpenAIDecision({
      ...args,
      fetchImpl: async () => response({
        answers: [
          {
            type: "choice",
            name: CATEGORY_QUESTION.name,
            choice: "throttling",
            probabilities: [{ value: "throttling", probability: "0.8" }],
          },
          { type: "predicate", name: ATTENTION_QUESTION.name, probability: 0.5 },
        ],
      }),
    }),
    /invalid decision/,
  );
});

test("OpenAI adapter reports connection, timeout, HTTP, JSON, refusal, and answer errors", async (t) => {
  const args = { incident, model: "gpt-6-luna", apiKey };

  await t.test("connection failure", async () => {
    await assert.rejects(
      requestOpenAIDecision({
        ...args,
        fetchImpl: async () => { throw new Error(`failed with ${apiKey}`); },
      }),
      (error) => {
        assert.match(error.message, /Could not connect to the OpenAI Decisions API/);
        assert.equal(error.message.includes(apiKey), false);
        return true;
      },
    );
  });

  await t.test("timeout", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    await assert.rejects(
      requestOpenAIDecision({ ...args, fetchImpl: async () => { throw timeout; }, timeoutMs: 25 }),
      /timed out after 25 ms/,
    );
  });

  await t.test("authentication, access, and rate limit statuses do not expose response bodies", async () => {
    for (const [status, expected] of [
      [401, /rejected the API key/],
      [403, /denied access/],
      [429, /rate limit or quota/],
    ]) {
      await assert.rejects(
        requestOpenAIDecision({
          ...args,
          fetchImpl: async () => response(`body contains ${apiKey}`, status),
        }),
        (error) => {
          assert.match(error.message, expected);
          assert.equal(error.message.includes(apiKey), false);
          return true;
        },
      );
    }
  });

  await t.test("other HTTP failures", async () => {
    await assert.rejects(
      requestOpenAIDecision({ ...args, fetchImpl: async () => response("not found", 404) }),
      /could not find the Decisions endpoint or configured model/,
    );
    await assert.rejects(
      requestOpenAIDecision({ ...args, fetchImpl: async () => response("failed", 500) }),
      /failed with HTTP 500/,
    );
  });

  await t.test("invalid JSON", async () => {
    await assert.rejects(
      requestOpenAIDecision({ ...args, fetchImpl: async () => response("{") }),
      /invalid JSON from \/v1\/decisions/,
    );
  });

  await t.test("refusal and invalid answers", async () => {
    await assert.rejects(
      requestOpenAIDecision({
        ...args,
        fetchImpl: async () => response({ answers: [{ type: "refusal", name: "category" }] }),
      }),
      /refused one or more decisions/,
    );
    await assert.rejects(
      requestOpenAIDecision({ ...args, fetchImpl: async () => response({ answers: [] }) }),
      /missing a required named answer/,
    );
  });
});
