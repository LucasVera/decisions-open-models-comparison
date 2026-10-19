import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  ATTENTION_QUESTION,
  ATTENTION_THRESHOLD,
  CATEGORY_QUESTION,
  normalizeDecision,
} from "./decisions.js";
import { requestOllamaDecision } from "./providers/ollama.js";
import { requestOpenAIDecision } from "./providers/openai.js";

const PROJECT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DATASET_PATH = resolve(PROJECT_DIRECTORY, "data", "incidents.json");
export const RESULTS_DIRECTORY = resolve(PROJECT_DIRECTORY, "results");
export const SCORING_VERSION = "full-dataset-v1";

const CATEGORY_VALUES = new Set(CATEGORY_QUESTION.options.map(({ value }) => value));
const SCORING_RULES = Object.freeze({
  version: SCORING_VERSION,
  accuracyDenominator: "full_dataset",
  unavailableDecisionsCorrect: false,
  averageLatencyDenominator: "timed_attempts_including_failures",
  latencyUnit: "ms",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateDataset(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Dataset must be a nonempty array of incidents.");
  }

  const ids = new Set();
  for (const [index, incident] of value.entries()) {
    const row = index + 1;
    if (!isRecord(incident)) {
      throw new Error(`Dataset incident ${row} must be an object.`);
    }
    if (typeof incident.id !== "string" || incident.id.trim() === "") {
      throw new Error(`Dataset incident ${row} must have a nonempty ID.`);
    }
    if (ids.has(incident.id)) {
      throw new Error(`Dataset contains a duplicate incident ID: ${incident.id}.`);
    }
    ids.add(incident.id);

    if (typeof incident.description !== "string" || incident.description.trim() === "") {
      throw new Error(`Dataset incident ${incident.id} must have a nonempty description.`);
    }
    if (!CATEGORY_VALUES.has(incident.expectedCategory)) {
      throw new Error(`Dataset incident ${incident.id} has an unknown expected category.`);
    }
    if (typeof incident.expectedRequiresAttention !== "boolean") {
      throw new Error(`Dataset incident ${incident.id} must have a boolean expected attention value.`);
    }
  }

  return value;
}

export async function readDataset(dataPath) {
  let contents;
  try {
    contents = await readFile(dataPath, "utf8");
  } catch (error) {
    throw new Error(`Could not read dataset at ${dataPath}: ${error.message}`, { cause: error });
  }

  let dataset;
  try {
    dataset = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Dataset at ${dataPath} is not valid JSON: ${error.message}`, { cause: error });
  }

  try {
    return { dataset: validateDataset(dataset), contents };
  } catch (error) {
    throw new Error(`Dataset validation failed at ${dataPath}: ${error.message}`, { cause: error });
  }
}

export function decisionDefinitionHash() {
  return hash(JSON.stringify({
    categoryQuestion: CATEGORY_QUESTION,
    attentionQuestion: ATTENTION_QUESTION,
    attentionThreshold: ATTENTION_THRESHOLD,
  }));
}

function requestForConfig(config) {
  if (config.provider === "ollama") {
    return (incident, hooks) => requestOllamaDecision({
      incident,
      model: config.model,
      baseUrl: config.baseUrl,
      onResponseMetadata: hooks.onResponseMetadata,
    });
  }
  if (config.provider === "openai") {
    return (incident, hooks) => requestOpenAIDecision({
      incident,
      model: config.model,
      apiKey: config.apiKey,
      onResponseMetadata: hooks.onResponseMetadata,
    });
  }
  throw new Error('Evaluation provider must be either "ollama" or "openai".');
}

function validateConfig(config) {
  if (!isRecord(config) || !["ollama", "openai"].includes(config.provider)) {
    throw new Error('Evaluation provider must be either "ollama" or "openai".');
  }
  if (typeof config.model !== "string" || config.model.trim() === "") {
    throw new Error("The selected provider model must be a nonempty string.");
  }
  if (config.provider === "openai" && (typeof config.apiKey !== "string" || config.apiKey.trim() === "")) {
    throw new Error("OPENAI_API_KEY is required when MODEL_PROVIDER is openai.");
  }
  if (config.provider === "ollama" && (typeof config.baseUrl !== "string" || config.baseUrl.trim() === "")) {
    throw new Error("OLLAMA_BASE_URL must be a nonempty URL.");
  }
}

function redactSecret(value, config) {
  let text = value;
  if (typeof config.apiKey === "string" && config.apiKey !== "") {
    text = text.replaceAll(config.apiKey, "[redacted]");
  }
  return text;
}

function safeErrorMessage(error, config) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecret(message, config);
}

function correctnessLabel(value) {
  if (value === null) return "unavailable";
  return value ? "correct" : "incorrect";
}

function formatDecision(row) {
  if (!row.decision) return "unavailable";
  return row.decision.category;
}

function formatProbabilityMap(value) {
  if (value === null) return "unavailable";
  return JSON.stringify(value);
}

function attentionLabel(value) {
  if (value === null) return "unavailable";
  return value ? "yes" : "no";
}

function displayIncident(row, index, total, output) {
  output(`[${index + 1}/${total}] ${row.id}`);
  output(
    `  Category: ${formatDecision(row)} (expected ${row.expected.category}; ${correctnessLabel(row.correctness.category)})`,
  );
  output(`  Category probabilities: ${formatProbabilityMap(row.decision?.categoryProbabilities ?? null)}`);
  const probability = row.decision?.requiresAttentionProbability;
  output(
    `  Attention: ${attentionLabel(row.decision?.requiresAttention ?? null)} (probability ${probability ?? "unavailable"}; expected ${row.expected.requiresAttention ? "yes" : "no"}; ${correctnessLabel(row.correctness.requiresAttention)})`,
  );
  output(`  Elapsed: ${row.elapsedMs.toFixed(2)} ms`);
  if (row.error) output(`  Error: ${row.error}`);
}

function metricsFor(rows) {
  const totalCount = rows.length;
  const categoryCorrectCount = rows.filter((row) => row.correctness.category === true).length;
  const attentionCorrectCount = rows.filter((row) => row.correctness.requiresAttention === true).length;
  const timedRows = rows.filter((row) => typeof row.elapsedMs === "number");
  const latencySum = timedRows.reduce((sum, row) => sum + row.elapsedMs, 0);
  const completedCount = rows.filter((row) => row.status === "complete").length;
  const requestFailureCount = rows.filter((row) => row.status === "failed").length;
  const unavailableDecisionCount = rows.filter((row) => row.status === "partial").length;

  return {
    totalCount,
    completedCount,
    failedCount: totalCount - completedCount,
    requestFailureCount,
    unavailableDecisionCount,
    categoryAccuracy: {
      correctCount: categoryCorrectCount,
      denominator: totalCount,
      value: categoryCorrectCount / totalCount,
    },
    attentionAccuracy: {
      correctCount: attentionCorrectCount,
      denominator: totalCount,
      value: attentionCorrectCount / totalCount,
    },
    averageLatencyMs: timedRows.length > 0 ? latencySum / timedRows.length : null,
    latencyAttemptCount: timedRows.length,
  };
}

function displaySummary(summary, output) {
  const categoryPercent = (summary.categoryAccuracy.value * 100).toFixed(1);
  const attentionPercent = (summary.attentionAccuracy.value * 100).toFixed(1);
  output(`Category accuracy: ${summary.categoryAccuracy.correctCount}/${summary.categoryAccuracy.denominator} (${categoryPercent}%)`);
  output(`Attention accuracy: ${summary.attentionAccuracy.correctCount}/${summary.attentionAccuracy.denominator} (${attentionPercent}%)`);
  output(
    `Average latency: ${summary.averageLatencyMs.toFixed(2)} ms across ${summary.latencyAttemptCount} timed attempts, including failed requests.`,
  );
  output(
    `Completed: ${summary.completedCount}; failed: ${summary.failedCount} (request failures: ${summary.requestFailureCount}; unavailable required decisions: ${summary.unavailableDecisionCount}).`,
  );
}

function normalizeProviderDecision(value) {
  if (!isRecord(value)) {
    throw new Error("Provider returned no normalized decision object.");
  }
  const decision = normalizeDecision({
    category: value.category,
    categoryProbabilities: value.categoryProbabilities,
    requiresAttentionProbability: value.requiresAttentionProbability ?? undefined,
  });
  if (value.requiresAttention !== decision.requiresAttention) {
    throw new Error("Provider returned an inconsistent attention decision.");
  }
  return decision;
}

function accuracyLine(row) {
  return {
    category: row.decision === null ? null : row.decision.category === row.expected.category,
    requiresAttention: row.decision?.requiresAttention === null || !row.decision
      ? null
      : row.decision.requiresAttention === row.expected.requiresAttention,
  };
}

export async function runEvaluation({
  config,
  dataPath = DATASET_PATH,
  resultsDirectory = RESULTS_DIRECTORY,
  requestDecision,
  output = console.log,
  now = () => performance.now(),
  runTime = () => new Date(),
} = {}) {
  validateConfig(config);
  const { dataset, contents } = await readDataset(dataPath);
  const request = requestDecision ?? requestForConfig(config);
  if (typeof request !== "function") {
    throw new TypeError("Evaluation decision request must be a function.");
  }

  const runStartedAt = runTime().toISOString();
  const rows = [];
  const returnedModels = new Set();

  for (const [index, incident] of dataset.entries()) {
    const startedAt = now();
    let elapsedMs;
    let decision = null;
    let rawDecision;
    let returnedModel = null;
    let errorMessage = null;

    try {
      rawDecision = await request(incident, {
        onResponseMetadata(metadata) {
          if (isRecord(metadata) && typeof metadata.model === "string" && metadata.model.trim() !== "") {
            returnedModel = redactSecret(metadata.model, config);
            returnedModels.add(returnedModel);
          }
        },
      });
    } catch (error) {
      errorMessage = safeErrorMessage(error, config);
    } finally {
      elapsedMs = Math.max(0, now() - startedAt);
    }

    if (!errorMessage) {
      try {
        decision = normalizeProviderDecision(rawDecision);
      } catch (error) {
        errorMessage = safeErrorMessage(error, config);
      }
    }

    const expected = {
      category: incident.expectedCategory,
      requiresAttention: incident.expectedRequiresAttention,
    };
    const status = errorMessage
      ? "failed"
      : decision.requiresAttention === null
        ? "partial"
        : "complete";
    if (!errorMessage && status === "partial") {
      errorMessage = "Attention decision unavailable because its probability was not returned.";
    }

    const row = {
      id: incident.id,
      description: incident.description,
      expected,
      decision,
      correctness: { category: null, requiresAttention: null },
      status,
      error: errorMessage,
      elapsedMs,
      returnedModel,
    };
    row.correctness = accuracyLine(row);
    rows.push(row);
    displayIncident(row, index, dataset.length, output);
  }

  const summary = metricsFor(rows);
  displaySummary(summary, output);

  const result = {
    schemaVersion: 1,
    provider: config.provider,
    requestedModel: redactSecret(config.model, config),
    returnedModels: [...returnedModels],
    runAt: runStartedAt,
    dataset: {
      path: "data/incidents.json",
      sha256: hash(contents),
      incidentCount: dataset.length,
    },
    decisionDefinitions: {
      sha256: decisionDefinitionHash(),
      attentionThreshold: ATTENTION_THRESHOLD,
    },
    scoring: SCORING_RULES,
    summary,
    incidents: rows,
  };

  const outputPath = resolve(resultsDirectory, `${config.provider}.json`);
  try {
    await mkdir(resultsDirectory, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new Error(`Could not save evaluation to ${outputPath}: ${safeErrorMessage(error, config)}`, { cause: error });
  }

  output(`Saved evaluation: ${outputPath}`);
  return { result, outputPath, hasFailures: summary.failedCount > 0 };
}
