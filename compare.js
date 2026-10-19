import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ATTENTION_THRESHOLD, CATEGORY_QUESTION, normalizeCategoryProbabilities } from "./decisions.js";
import { DATASET_PATH, decisionDefinitionHash, readDataset } from "./evaluation.js";
import { analyzeResult } from "./analysis.js";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
export const OLLAMA_RESULTS_PATH = resolve(projectDirectory, "results", "ollama.json");
export const OPENAI_RESULTS_PATH = resolve(projectDirectory, "results", "openai.json");
const NOTES_PATH = resolve(projectDirectory, "data", "incident-notes.json");

const CATEGORY_VALUES = new Set(CATEGORY_QUESTION.options.map(({ value }) => value));
const SCORING_RULES = Object.freeze({
  version: "full-dataset-v1",
  accuracyDenominator: "full_dataset",
  unavailableDecisionsCorrect: false,
  averageLatencyDenominator: "timed_attempts_including_failures",
  latencyUnit: "ms",
});
const SHA256_PATTERN = /^[a-f\d]{64}$/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasSupportedScoringRules(value) {
  const entries = Object.entries(SCORING_RULES);
  return isRecord(value)
    && Object.keys(value).length === entries.length
    && entries.every(([key, expected]) => value[key] === expected);
}

function validateProbability(value, label) {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite number from 0 through 1.`);
  }
}

function validateDecision(value, threshold, id) {
  if (!isRecord(value) || !CATEGORY_VALUES.has(value.category)) {
    throw new Error(`incident ${id} has an invalid decision category.`);
  }

  if (value.categoryProbabilities !== null) {
    if (!isRecord(value.categoryProbabilities)) {
      throw new Error(`incident ${id} has an invalid category probability map.`);
    }
    normalizeCategoryProbabilities(value.categoryProbabilities);
  }

  const probability = value.requiresAttentionProbability;
  if (probability === null) {
    if (value.requiresAttention !== null) {
      throw new Error(`incident ${id} has an attention decision without a probability.`);
    }
  } else {
    validateProbability(probability, `incident ${id} attention probability`);
    if (value.requiresAttention !== (probability >= threshold)) {
      throw new Error(`incident ${id} has an attention decision inconsistent with its probability.`);
    }
  }
}

function validateIncident(row, index, threshold) {
  const label = `incident row ${index + 1}`;
  if (!isRecord(row)) throw new Error(`${label} must be an object.`);
  if (typeof row.id !== "string" || row.id.trim() === "") {
    throw new Error(`${label} must have a nonempty ID.`);
  }
  if (typeof row.description !== "string" || row.description.trim() === "") {
    throw new Error(`incident ${row.id} must have a nonempty description.`);
  }
  if (!isRecord(row.expected) || !CATEGORY_VALUES.has(row.expected.category)) {
    throw new Error(`incident ${row.id} has invalid expected outcomes.`);
  }
  if (typeof row.expected.requiresAttention !== "boolean") {
    throw new Error(`incident ${row.id} has invalid expected attention.`);
  }
  if (!isRecord(row.correctness)) {
    throw new Error(`incident ${row.id} has invalid correctness values.`);
  }
  if (!["complete", "partial", "failed"].includes(row.status)) {
    throw new Error(`incident ${row.id} has an unsupported status.`);
  }
  if (!isFiniteNumber(row.elapsedMs) || row.elapsedMs < 0) {
    throw new Error(`incident ${row.id} has invalid elapsed time.`);
  }
  if (row.error !== null && typeof row.error !== "string") {
    throw new Error(`incident ${row.id} has an invalid error value.`);
  }
  if (row.returnedModel !== null && typeof row.returnedModel !== "string") {
    throw new Error(`incident ${row.id} has an invalid returned model value.`);
  }

  if (row.status === "failed") {
    if (row.decision !== null || row.error === null) {
      throw new Error(`failed incident ${row.id} must contain an error and no decision.`);
    }
    if (row.correctness.category !== null || row.correctness.requiresAttention !== null) {
      throw new Error(`failed incident ${row.id} cannot have correctness values.`);
    }
    return;
  }

  validateDecision(row.decision, threshold, row.id);
  const expectedCategoryCorrect = row.decision.category === row.expected.category;
  if (row.correctness.category !== expectedCategoryCorrect) {
    throw new Error(`incident ${row.id} has incorrect category scoring.`);
  }

  if (row.status === "partial") {
    if (row.decision.requiresAttention !== null || row.correctness.requiresAttention !== null || row.error === null) {
      throw new Error(`partial incident ${row.id} must have an unavailable attention decision and an error.`);
    }
    return;
  }

  if (row.decision.requiresAttention === null || row.error !== null) {
    throw new Error(`complete incident ${row.id} must have both decisions and no error.`);
  }
  if (row.correctness.requiresAttention !== (row.decision.requiresAttention === row.expected.requiresAttention)) {
    throw new Error(`incident ${row.id} has incorrect attention scoring.`);
  }
}

function validateSummary(summary, incidents) {
  if (!isRecord(summary)) throw new Error("summary must be an object.");

  const totalCount = incidents.length;
  const completedCount = incidents.filter((row) => row.status === "complete").length;
  const requestFailureCount = incidents.filter((row) => row.status === "failed").length;
  const unavailableDecisionCount = incidents.filter((row) => row.status === "partial").length;
  const categoryCorrectCount = incidents.filter((row) => row.correctness.category === true).length;
  const attentionCorrectCount = incidents.filter((row) => row.correctness.requiresAttention === true).length;
  const latencySum = incidents.reduce((sum, row) => sum + row.elapsedMs, 0);

  const expectedCounts = {
    totalCount,
    completedCount,
    failedCount: totalCount - completedCount,
    requestFailureCount,
    unavailableDecisionCount,
    latencyAttemptCount: totalCount,
  };
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (summary[key] !== expected) {
      throw new Error(`summary.${key} does not match the incident rows.`);
    }
  }

  for (const [key, correctCount] of [
    ["categoryAccuracy", categoryCorrectCount],
    ["attentionAccuracy", attentionCorrectCount],
  ]) {
    const metric = summary[key];
    if (
      !isRecord(metric)
      || metric.correctCount !== correctCount
      || metric.denominator !== totalCount
      || !isFiniteNumber(metric.value)
      || Math.abs(metric.value - correctCount / totalCount) > 1e-12
    ) {
      throw new Error(`summary.${key} does not match the incident rows.`);
    }
  }

  if (!isFiniteNumber(summary.averageLatencyMs) || summary.averageLatencyMs < 0) {
    throw new Error("summary.averageLatencyMs must be a nonnegative number.");
  }
  if (Math.abs(summary.averageLatencyMs - latencySum / totalCount) > 1e-9) {
    throw new Error("summary.averageLatencyMs does not match the incident rows.");
  }
}

export function validateSavedResult(value, path, expectedProvider) {
  if (!isRecord(value)) throw new Error("root value must be an object.");
  if (value.schemaVersion !== 1) throw new Error("unsupported or missing schemaVersion.");
  if (value.provider !== expectedProvider) {
    throw new Error(`provider must be ${expectedProvider} for this result path.`);
  }
  if (typeof value.requestedModel !== "string" || value.requestedModel.trim() === "") {
    throw new Error("requestedModel must be a nonempty string.");
  }
  if (!Array.isArray(value.returnedModels) || value.returnedModels.some((model) => typeof model !== "string")) {
    throw new Error("returnedModels must be an array of strings.");
  }
  if (typeof value.runAt !== "string" || !Number.isFinite(Date.parse(value.runAt))) {
    throw new Error("runAt must be a valid date string.");
  }

  if (!isRecord(value.dataset)) throw new Error("dataset must be an object.");
  if (typeof value.dataset.path !== "string" || value.dataset.path.trim() === "") {
    throw new Error("dataset.path must be a nonempty string.");
  }
  if (typeof value.dataset.sha256 !== "string" || !SHA256_PATTERN.test(value.dataset.sha256)) {
    throw new Error("dataset.sha256 must be a SHA-256 digest.");
  }
  if (!Number.isSafeInteger(value.dataset.incidentCount) || value.dataset.incidentCount < 1) {
    throw new Error("dataset.incidentCount must be a positive safe integer.");
  }

  if (!isRecord(value.decisionDefinitions)) throw new Error("decisionDefinitions must be an object.");
  if (
    typeof value.decisionDefinitions.sha256 !== "string"
    || !SHA256_PATTERN.test(value.decisionDefinitions.sha256)
  ) {
    throw new Error("decisionDefinitions.sha256 must be a SHA-256 digest.");
  }
  validateProbability(value.decisionDefinitions.attentionThreshold, "decisionDefinitions.attentionThreshold");

  if (!hasSupportedScoringRules(value.scoring)) {
    throw new Error("scoring rules are missing or unsupported.");
  }
  if (!Array.isArray(value.incidents) || value.incidents.length !== value.dataset.incidentCount) {
    throw new Error("incidents must contain exactly the dataset incident count.");
  }

  const seenIds = new Set();
  value.incidents.forEach((row, index) => {
    validateIncident(row, index, value.decisionDefinitions.attentionThreshold);
    if (seenIds.has(row.id)) throw new Error(`duplicate incident ID ${row.id}.`);
    seenIds.add(row.id);
  });
  validateSummary(value.summary, value.incidents);
  return { ...value, path, provider: expectedProvider };
}

function regenerationInstruction(provider) {
  return `setting MODEL_PROVIDER=${provider} in .env and running npm run eval`;
}

export async function readResult(path, provider) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read evaluation at ${path}: ${error.message} Regenerate it by ${regenerationInstruction(provider)}.`);
  }

  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Evaluation at ${path} is not valid JSON: ${error.message} Regenerate it by ${regenerationInstruction(provider)}.`);
  }

  try {
    return validateSavedResult(value, path, provider);
  } catch (error) {
    throw new Error(`Evaluation at ${path} is incompatible: ${error.message} Regenerate it by ${regenerationInstruction(provider)}.`);
  }
}

function describeEvidenceDifferences(ollama, openai) {
  const mismatches = [];
  if (ollama.dataset.sha256 !== openai.dataset.sha256) {
    mismatches.push("dataset file hashes differ");
  }
  if (ollama.dataset.incidentCount !== openai.dataset.incidentCount) {
    mismatches.push("dataset incident counts differ");
  }
  const maxRows = Math.max(ollama.incidents.length, openai.incidents.length);
  for (let index = 0; index < maxRows; index += 1) {
    const left = ollama.incidents[index];
    const right = openai.incidents[index];
    if (!left || !right || left.id !== right.id) {
      mismatches.push(`incident order or IDs differ at row ${index + 1}`);
      continue;
    }
    if (
      left.description !== right.description
      || left.expected.category !== right.expected.category
      || left.expected.requiresAttention !== right.expected.requiresAttention
    ) {
      mismatches.push(`evidence or expected outcomes differ for incident ${left.id}`);
    }
  }
  return [...new Set(mismatches)];
}

export function findCompatibilityIssues(ollama, openai) {
  const issues = describeEvidenceDifferences(ollama, openai);
  if (ollama.decisionDefinitions.sha256 !== openai.decisionDefinitions.sha256) {
    issues.push("decision definition hashes differ");
  }
  if (ollama.decisionDefinitions.attentionThreshold !== openai.decisionDefinitions.attentionThreshold) {
    issues.push("attention thresholds differ");
  }
  if (!hasSupportedScoringRules(ollama.scoring) || !hasSupportedScoringRules(openai.scoring)) {
    issues.push("scoring rules differ");
  }
  return issues;
}

function cleanCell(value, maxLength = 32) {
  const text = String(value).replace(/[|\r\n]+/g, " /").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function accuracyText(metric) {
  return `${metric.correctCount}/${metric.denominator} (${(metric.value * 100).toFixed(1)}%)`;
}

function modelText(result) {
  const returned = [...new Set(result.returnedModels)].filter((model) => model !== result.requestedModel);
  if (returned.length === 0) return result.requestedModel;
  return `${result.requestedModel} (returned: ${returned.join(", ")})`;
}

export function formatComparison(...results) {
  const rows = results.map((result) => {
    const isPartial = result.summary.failedCount > 0;
    return [
      `${result.provider === "ollama" ? "Ollama" : "OpenAI"} ${isPartial ? "(PARTIAL)" : "(COMPLETE)"}`,
      cleanCell(modelText(result)),
      accuracyText(result.summary.categoryAccuracy),
      accuracyText(result.summary.attentionAccuracy),
      result.summary.averageLatencyMs.toFixed(2),
      `${result.summary.completedCount} / ${result.summary.failedCount}`,
    ];
  });
  const headers = ["Provider", "Model", "Category accuracy", "Attention accuracy", "Avg latency (ms)", "Complete / failed"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );
  const line = (cells) => `| ${cells.map((cell, index) => cell.padEnd(widths[index])).join(" | ")} |`;
  const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return ["Saved-result comparison", line(headers), divider, ...rows.map(line)].join("\n");
}

function incompleteRunNotes(results, output) {
  for (const result of results) {
    if (result.summary.failedCount === 0) continue;
    output(
      `${result.provider} is partial: ${result.summary.completedCount}/${result.summary.totalCount} complete, `
      + `${result.summary.requestFailureCount} request failures, `
      + `${result.summary.unavailableDecisionCount} unavailable required decisions. `
      + `Rerun it after ${regenerationInstruction(result.provider)}.`,
    );
  }
}

export function findCurrentEvidenceIssues(result, dataset, contents) {
  const issues = [];
  const digest = createHash("sha256").update(contents).digest("hex");
  if (result.dataset.sha256 !== digest || result.dataset.incidentCount !== dataset.length
    || dataset.some((row, index) => row.id !== result.incidents[index]?.id
      || row.description !== result.incidents[index]?.description
      || row.expectedCategory !== result.incidents[index]?.expected.category
      || row.expectedRequiresAttention !== result.incidents[index]?.expected.requiresAttention)) {
    issues.push(`${result.provider} saved evaluation is stale for the current dataset`);
  }
  if (result.decisionDefinitions.sha256 !== decisionDefinitionHash()
    || result.decisionDefinitions.attentionThreshold !== ATTENTION_THRESHOLD) {
    issues.push(`${result.provider} saved decision definitions differ from the current definitions`);
  }
  return issues;
}

export async function main({
  ollamaPath = OLLAMA_RESULTS_PATH,
  openaiPath = OPENAI_RESULTS_PATH,
  dataPath = DATASET_PATH,
  notesPath = dataPath === DATASET_PATH ? NOTES_PATH : null,
  analysisPath = resolve(dirname(ollamaPath), "comparison.json"),
  output = console.log,
  errorOutput = console.error,
} = {}) {
  const settled = await Promise.allSettled([
    readResult(ollamaPath, "ollama"),
    readResult(openaiPath, "openai"),
  ]);
  const errors = settled.filter((item) => item.status === "rejected").map((item) => item.reason);
  if (errors.length > 0) {
    for (const error of errors) errorOutput(`Comparison failed: ${error.message}`);
    return { ok: false, partial: false };
  }

  const [ollama, openai] = settled.map((item) => item.value);
  const issues = findCompatibilityIssues(ollama, openai);
  let analyses = null;
  if (dataPath !== null) {
    try {
      const { dataset, contents } = await readDataset(dataPath);
      for (const result of [ollama, openai]) {
        issues.push(...findCurrentEvidenceIssues(result, dataset, contents));
      }
      if (issues.length === 0 && notesPath !== null) {
        const notes = JSON.parse(await readFile(notesPath, "utf8"));
        analyses = { ollama: analyzeResult(ollama, notes), openai: analyzeResult(openai, notes) };
      }
    } catch (error) {
      errorOutput(`Comparison failed while checking current evidence: ${error.message}`);
      return { ok: false, partial: false };
    }
  }
  if (issues.length > 0) {
    errorOutput("Cannot compare these evaluations fairly:");
    for (const issue of issues) errorOutput(`- ${issue}.`);
    errorOutput(
      `Rerun both evaluations with the same dataset and definitions: set MODEL_PROVIDER=ollama and run npm run eval, `
      + `then set MODEL_PROVIDER=openai and run npm run eval.`,
    );
    return { ok: false, partial: false };
  }

  if (analyses) {
    try {
      await writeFile(analysisPath, `${JSON.stringify({ dataset: ollama.dataset, analyses }, null, 2)}\n`, "utf8");
    } catch (error) {
      errorOutput(`Could not save offline analysis: ${error.message}`);
      return { ok: false, partial: false };
    }
  }
  output(dataPath === null ? "Historical comparison; current dataset and definitions were not checked."
    : `Current dataset: ${ollama.dataset.incidentCount} incidents; dataset and decision definitions match.`);
  output(formatComparison(ollama, openai));
  if (analyses) {
    for (const [provider, analysis] of Object.entries(analyses)) {
      const attention = analysis.all.attention;
      output(`${provider}: attention false alarms=${attention.falsePositive}, misses=${attention.falseNegative}, unavailable=${attention.unavailablePositive + attention.unavailableNegative}.`);
      for (const [split, metrics] of Object.entries(analysis.splits)) {
        output(`  ${split}: ${metrics.count} cases; category=${(metrics.categoryAccuracy * 100).toFixed(1)}%; attention=${(metrics.attentionAccuracy * 100).toFixed(1)}%.`);
      }
    }
    output(`Offline analysis saved: ${analysisPath}`);
  }
  const results = [ollama, openai];
  incompleteRunNotes(results, output);
  const partial = results.some((result) => result.summary.failedCount > 0);
  return { ok: !partial, partial };
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  main(process.argv.includes("--historical") ? { dataPath: null } : {}).then(({ ok }) => {
    if (!ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(`Comparison failed: ${error.message}`);
    process.exitCode = 1;
  });
}
