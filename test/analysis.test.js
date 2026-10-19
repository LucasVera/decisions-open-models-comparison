import assert from "node:assert/strict";
import test from "node:test";
import { analyzeResult, summarizeDecisions } from "../analysis.js";

const rows = [
  { id: "a", expected: { category: "throttling", requiresAttention: true },
    decision: { category: "other", categoryProbabilities: { throttling: 0.25, authentication: 0.25, dependency_failure: 0.25, other: 0.25 },
      requiresAttention: false, requiresAttentionProbability: 0.2 }, correctness: { category: false, requiresAttention: false }, elapsedMs: 10 },
  { id: "b", expected: { category: "other", requiresAttention: false },
    decision: { category: "other", categoryProbabilities: { other: 0.9 }, requiresAttention: true, requiresAttentionProbability: 0.8 },
    correctness: { category: true, requiresAttention: false }, elapsedMs: 20 },
  { id: "c", expected: { category: "authentication", requiresAttention: true },
    decision: null, correctness: { category: null, requiresAttention: null }, elapsedMs: 30 },
  { id: "d", expected: { category: "dependency_failure", requiresAttention: false },
    decision: { category: "dependency_failure", categoryProbabilities: null, requiresAttention: null, requiresAttentionProbability: null },
    correctness: { category: true, requiresAttention: null }, elapsedMs: 40 },
];
const result = { dataset: { sha256: "a".repeat(64) }, incidents: rows };
const notes = { count: 4, sha256: result.dataset.sha256, independentReview: { status: "pending", reviewer: null },
  cases: rows.map((row, index) => ({ id: row.id, expectedCategory: row.expected.category,
    expectedRequiresAttention: row.expected.requiresAttention, scenarioFamily: index < 2 ? "rate" : "access",
    split: index < 2 ? "development" : "held-out" })) };

test("offline analysis counts wrong, partial and failed answers with probability coverage", () => {
  const metrics = summarizeDecisions(rows);
  assert.equal(metrics.categoryAccuracy, 0.5);
  assert.equal(metrics.attentionAccuracy, 0);
  assert.equal(metrics.categoryConfusion.throttling.other, 1);
  assert.equal(metrics.categoryConfusion.authentication.unavailable, 1);
  assert.deepEqual(metrics.attention, { truePositive: 0, trueNegative: 0, falsePositive: 1, falseNegative: 1,
    unavailablePositive: 1, unavailableNegative: 1, precision: 0, recall: 0 });
  assert.deepEqual(metrics.categoryBrier, { count: 1, value: 0.75 });
  assert.equal(metrics.attentionBrier.count, 2);
  assert.ok(Math.abs(metrics.attentionBrier.value - 0.64) < 1e-12);
  assert.deepEqual(metrics.latencyMs, { mean: 25, p50: 20, p95: 40 });
  assert.equal(summarizeDecisions([]).categoryAccuracy, null);
  assert.equal(summarizeDecisions([rows[2]]).categoryBrier.value, null);
  assert.equal(summarizeDecisions([rows[2]]).attention.precision, null);
  const correct = rows.slice(0, 2).map((row) => ({ ...row,
    decision: { ...row.decision, requiresAttention: row.expected.requiresAttention },
    correctness: { ...row.correctness, requiresAttention: true } }));
  const attention = summarizeDecisions(correct).attention;
  assert.equal(attention.truePositive, 1);
  assert.equal(attention.trueNegative, 1);
  assert.equal(attention.precision, 1);
  assert.equal(attention.recall, 1);
});

test("split and family reports use matching evaluation-only notes", () => {
  const analysis = analyzeResult(result, notes);
  assert.equal(analysis.splits.development.count, 2);
  assert.equal(analysis.splits['held-out'].categoryAccuracy, 0.5);
  assert.equal(analysis.families.rate.categoryAccuracy, 0.5);
  assert.deepEqual(analysis.labelReview, notes.independentReview);
  for (const mutate of [
    (n) => { n.sha256 = "b".repeat(64); },
    (n) => { n.cases[0].id = "wrong"; },
    (n) => { n.cases[0].expectedRequiresAttention = false; },
    (n) => { n.cases[1].split = "held-out"; },
    (n) => { n.cases[0].scenarioFamily = ""; },
  ]) {
    const invalid = structuredClone(notes);
    mutate(invalid);
    assert.throws(() => analyzeResult(result, invalid), /notes/i);
  }
});
