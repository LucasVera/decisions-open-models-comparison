import { CATEGORY_QUESTION } from "./decisions.js";

const categories = CATEGORY_QUESTION.options.map(({ value }) => value);
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

// Rows have already passed saved-result validation. Unavailable decisions stay in accuracy denominators.
export function summarizeDecisions(rows) {
  const confusion = Object.fromEntries(categories.map((category) => [category,
    Object.fromEntries([...categories, "unavailable"].map((value) => [value, 0]))]));
  const attention = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0,
    unavailablePositive: 0, unavailableNegative: 0 };
  const categoryBrier = [];
  const attentionBrier = [];
  for (const row of rows) {
    confusion[row.expected.category][row.decision?.category ?? "unavailable"] += 1;
    const expected = row.expected.requiresAttention;
    const predicted = row.decision?.requiresAttention;
    let label;
    if (predicted === null || predicted === undefined) label = expected ? "unavailablePositive" : "unavailableNegative";
    else if (predicted === expected) label = expected ? "truePositive" : "trueNegative";
    else label = expected ? "falseNegative" : "falsePositive";
    attention[label] += 1;
    const probabilities = row.decision?.categoryProbabilities;
    if (probabilities && categories.every((category) => Object.hasOwn(probabilities, category))) {
      categoryBrier.push(categories.reduce((sum, category) =>
        sum + (probabilities[category] - Number(row.expected.category === category)) ** 2, 0));
    }
    const probability = row.decision?.requiresAttentionProbability;
    if (typeof probability === "number") attentionBrier.push((probability - Number(expected)) ** 2);
  }
  const latency = rows.map(({ elapsedMs }) => elapsedMs).sort((a, b) => a - b);
  return {
    count: rows.length,
    categoryAccuracy: ratio(rows.filter(({ correctness }) => correctness.category === true).length, rows.length),
    attentionAccuracy: ratio(rows.filter(({ correctness }) => correctness.requiresAttention === true).length, rows.length),
    categoryConfusion: confusion,
    attention: { ...attention,
      precision: ratio(attention.truePositive, attention.truePositive + attention.falsePositive),
      recall: ratio(attention.truePositive, attention.truePositive + attention.falseNegative + attention.unavailablePositive) },
    categoryBrier: { count: categoryBrier.length, value: mean(categoryBrier) },
    attentionBrier: { count: attentionBrier.length, value: mean(attentionBrier) },
    latencyMs: { mean: mean(latency), p50: latency[Math.ceil(latency.length * 0.5) - 1] ?? null,
      p95: latency[Math.ceil(latency.length * 0.95) - 1] ?? null },
  };
}

export function analyzeResult(result, notes) {
  if (!notes || notes.sha256 !== result.dataset.sha256 || notes.count !== result.incidents.length
    || !Array.isArray(notes.cases) || notes.cases.length !== result.incidents.length) {
    throw new Error("Evaluation notes must match the saved dataset hash and incident count.");
  }
  const seen = new Set();
  const familySplits = new Map();
  const splitRows = {};
  const familyRows = Object.create(null);
  for (const [index, note] of notes.cases.entries()) {
    const row = result.incidents[index];
    if (!note || seen.has(note.id) || note.id !== row.id || note.expectedCategory !== row.expected.category
      || note.expectedRequiresAttention !== row.expected.requiresAttention
      || !["development", "held-out"].includes(note.split)
      || typeof note.scenarioFamily !== "string" || !/^[a-z][a-z\d-]*$/.test(note.scenarioFamily)) {
      throw new Error(`Evaluation notes do not match incident row ${index + 1}.`);
    }
    if (familySplits.has(note.scenarioFamily) && familySplits.get(note.scenarioFamily) !== note.split) {
      throw new Error(`Evaluation notes split family ${note.scenarioFamily} across development and held-out cases.`);
    }
    seen.add(note.id);
    familySplits.set(note.scenarioFamily, note.split);
    (splitRows[note.split] ??= []).push(row);
    (familyRows[note.scenarioFamily] ??= []).push(row);
  }
  const grouped = (groups) => Object.fromEntries(Object.entries(groups).map(([name, rows]) => [name, summarizeDecisions(rows)]));
  return { all: summarizeDecisions(result.incidents), splits: grouped(splitRows), families: grouped(familyRows),
    labelReview: notes.independentReview ?? { status: "unknown", reviewer: null } };
}
