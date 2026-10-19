import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDecision } from "../decisions.js";

test("normalization applies the inclusive attention threshold", () => {
  for (const [probability, expected] of [
    [0.499999, false],
    [0.5, true],
    [0.500001, true],
  ]) {
    assert.equal(
      normalizeDecision({ category: "other", requiresAttentionProbability: probability })
        .requiresAttention,
      expected,
    );
  }
});

test("normalization preserves partial category maps and missing attention decisions", () => {
  assert.deepEqual(
    normalizeDecision({
      category: "throttling",
      categoryProbabilities: { throttling: 0.123456789 },
    }),
    {
      category: "throttling",
      categoryProbabilities: { throttling: 0.123456789 },
      requiresAttentionProbability: null,
      requiresAttention: null,
    },
  );

  assert.deepEqual(
    normalizeDecision({ category: "other", requiresAttentionProbability: 0.1 }),
    {
      category: "other",
      categoryProbabilities: null,
      requiresAttentionProbability: 0.1,
      requiresAttention: false,
    },
  );
});

test("normalization rejects invalid categories and supplied probabilities", () => {
  const invalidDecisions = [
    { category: "unknown" },
    { category: "other", categoryProbabilities: { unknown: 0.5 } },
    { category: "other", categoryProbabilities: { throttling: "0.5" } },
    { category: "other", categoryProbabilities: { throttling: Number.NaN } },
    { category: "other", categoryProbabilities: { throttling: -0.01 } },
    { category: "other", categoryProbabilities: { throttling: 1.01 } },
    { category: "other", requiresAttentionProbability: null },
    { category: "other", requiresAttentionProbability: "0.5" },
    { category: "other", requiresAttentionProbability: Number.POSITIVE_INFINITY },
  ];

  for (const decision of invalidDecisions) {
    assert.throws(() => normalizeDecision(decision), /Decision|probability/i);
  }
});

test("normalization checks probability mass while preserving partial maps and numerical tolerance", () => {
  for (const map of [
    { throttling: 0.9, authentication: 0.9, dependency_failure: 0.9, other: 0.9 },
    { throttling: 0.1, authentication: 0.1, dependency_failure: 0.1, other: 0.1 },
    { throttling: 0.8, other: 0.3 },
  ]) {
    assert.throws(() => normalizeDecision({ category: "other", categoryProbabilities: map }), /probability.*sum/i);
  }
  for (const map of [
    { throttling: 0.2, other: 0.3 },
    { throttling: 0.2, authentication: 0.3, dependency_failure: 0.1, other: 0.4000001 },
    { throttling: 0.2, authentication: 0.3, dependency_failure: 0.1, other: 0.3999999 },
  ]) {
    assert.deepEqual(normalizeDecision({ category: "other", categoryProbabilities: map }).categoryProbabilities, map);
  }
});
