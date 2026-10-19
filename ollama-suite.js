import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { analyzeResult } from "./analysis.js";
import { ATTENTION_THRESHOLD } from "./decisions.js";
import { DATASET_PATH, RESULTS_DIRECTORY, decisionDefinitionHash, readDataset, runEvaluation } from "./evaluation.js";
import { findCompatibilityIssues, findCurrentEvidenceIssues, formatComparison, readResult } from "./compare.js";
import { parseOllamaModels } from "./ollama-models.js";

export const SUITE_RESULTS_PATH = resolve(RESULTS_DIRECTORY, "ollama-suite.json");

export async function checkOllamaModel(model, baseUrl, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) throw new Error(`Model is not installed. Run: ollama pull ${model}`);
    if (!response.ok) throw new Error(`Ollama model inspection returned HTTP ${response.status}.`);
    let metadata;
    try {
      metadata = await response.json();
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") throw error;
      throw new Error("Ollama model inspection returned unreadable JSON.");
    }
    if (!Array.isArray(metadata.capabilities) || !metadata.capabilities.includes("decision")) {
      throw new Error("Installed model does not advertise the decision capability required by /v1/systemone.");
    }
    return { details: metadata.details ?? null, capabilities: metadata.capabilities };
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("Ollama model inspection timed out after 30000 ms.");
    if (!response) throw new Error("Could not connect to Ollama for model inspection. Check OLLAMA_BASE_URL and the server.");
    throw error;
  }
}

function modelDirectory(model) {
  const label = model.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return `${label}-${createHash("sha256").update(model).digest("hex").slice(0, 12)}`;
}

async function saveSuite(manifest, path) {
  const portable = {
    ...manifest,
    models: manifest.models.map((entry) => ({
      ...entry,
      path: entry.path === null ? null : relative(dirname(path), entry.path),
    })),
  };
  await writeFile(path, `${JSON.stringify(portable, null, 2)}\n`, "utf8");
}

export async function runOllamaSuite({
  config,
  models = config?.models,
  dataPath = DATASET_PATH,
  resultsDirectory = RESULTS_DIRECTORY,
  output = console.log,
  checkModel = checkOllamaModel,
  requestDecisionForModel,
} = {}) {
  if (config?.provider !== "ollama") throw new Error("Ollama model suites require MODEL_PROVIDER=ollama.");
  if (typeof config.baseUrl !== "string" || !config.baseUrl.trim()) throw new Error("OLLAMA_BASE_URL is required.");
  if (!Array.isArray(models) || models.length === 0 || models.some((model) => typeof model !== "string" || !model.trim())) {
    throw new Error("Select at least one Ollama model with OLLAMA_EVAL_MODELS or --models.");
  }
  const selected = parseOllamaModels(models.join(","));
  const { dataset, contents } = await readDataset(dataPath);
  await mkdir(resultsDirectory, { recursive: true });
  const runDirectory = await mkdtemp(resolve(resultsDirectory, "ollama-suite-"));
  const snapshotPath = resolve(runDirectory, "incidents.json");
  await writeFile(snapshotPath, contents, "utf8");
  const manifest = {
    schemaVersion: 1,
    provider: "ollama",
    runAt: new Date().toISOString(),
    dataset: { sha256: createHash("sha256").update(contents).digest("hex"), incidentCount: dataset.length },
    decisionDefinitions: { sha256: decisionDefinitionHash(), attentionThreshold: ATTENTION_THRESHOLD },
    selectedModels: selected,
    status: "running",
    models: [],
  };
  const manifestPath = resolve(runDirectory, "suite.json");
  const latestPath = resolve(resultsDirectory, "ollama-suite.json");
  const save = async () => {
    await saveSuite(manifest, manifestPath);
    await saveSuite(manifest, latestPath);
  };
  await save();

  for (const [index, model] of selected.entries()) {
    output(`\nModel ${index + 1}/${selected.length}: ${model}; ${dataset.length} incidents.`);
    let metadata;
    try {
      metadata = await checkModel(model, config.baseUrl);
    } catch (error) {
      const entry = { model, status: "unavailable", path: null, error: error.message };
      manifest.models.push(entry);
      output(`${model}: UNAVAILABLE; no inference requests made. ${entry.error}`);
      await save();
      continue;
    }
    // Inference and file-write failures are handled separately. A persistence error
    // must stop the suite, rather than disguising lost measurements as a model issue.
    const outcome = await runEvaluation({
      config: { ...config, model },
      dataPath: snapshotPath,
      resultsDirectory: resolve(runDirectory, modelDirectory(model)),
      output,
      requestDecision: requestDecisionForModel?.(model),
    });
    manifest.models.push({
      model,
      status: outcome.hasFailures ? "partial" : "complete",
      path: outcome.outputPath,
      error: null,
      metadata,
    });
    await save();
  }
  const hasFailures = manifest.models.some(({ status }) => status !== "complete");
  manifest.status = hasFailures ? "incomplete" : "complete";
  await save();
  output(`Suite ${manifest.status}: ${manifest.models.filter(({ status }) => status === "complete").length}/${selected.length} models complete.`);
  output(`Saved suite: ${manifestPath}`);
  return { manifest, manifestPath, latestPath, hasFailures };
}

export async function compareOllamaSuite({
  manifestPath = SUITE_RESULTS_PATH,
  dataPath = DATASET_PATH,
  notesPath = dataPath === DATASET_PATH ? resolve(dirname(DATASET_PATH), "incident-notes.json") : null,
  output = console.log,
} = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.provider !== "ollama" || !Array.isArray(manifest.models)
    || !Array.isArray(manifest.selectedModels) || manifest.selectedModels.length === 0
    || new Set(manifest.selectedModels).size !== manifest.selectedModels.length
    || !["running", "complete", "incomplete"].includes(manifest.status)) {
    throw new Error("Invalid Ollama suite manifest.");
  }
  const { dataset, contents } = await readDataset(dataPath);
  const digest = createHash("sha256").update(contents).digest("hex");
  if (manifest.dataset?.sha256 !== digest || manifest.dataset?.incidentCount !== dataset.length
    || manifest.decisionDefinitions?.sha256 !== decisionDefinitionHash()
    || manifest.decisionDefinitions?.attentionThreshold !== ATTENTION_THRESHOLD) {
    throw new Error("Ollama suite is stale for the current dataset or decision definitions. Rerun the suite.");
  }
  const results = [];
  const seen = new Set();
  let partial = manifest.status !== "complete";
  for (const entry of manifest.models) {
    if (!entry || !manifest.selectedModels.includes(entry.model) || seen.has(entry.model)
      || !["unavailable", "partial", "complete"].includes(entry.status)) {
      throw new Error("Invalid or duplicate Ollama suite model entry.");
    }
    seen.add(entry.model);
    if (entry.status === "unavailable") {
      if (entry.path !== null || typeof entry.error !== "string" || !entry.error) throw new Error("Invalid unavailable model entry.");
      output(`${entry.model}: UNAVAILABLE; no measured accuracy or latency. ${entry.error}`);
      partial = true;
      continue;
    }
    if (typeof entry.path !== "string" || !entry.path) throw new Error("Suite result path is missing.");
    const result = await readResult(resolve(dirname(manifestPath), entry.path), "ollama");
    const issues = findCurrentEvidenceIssues(result, dataset, contents);
    if (results.length > 0) issues.push(...findCompatibilityIssues(results[0], result));
    if (result.requestedModel !== entry.model) issues.push("saved model differs from the suite selection");
    if ((result.summary.failedCount > 0) !== (entry.status === "partial")) issues.push("saved status differs from the suite entry");
    if (issues.length > 0) throw new Error(`Cannot compare ${entry.model}: ${issues.join("; ")}.`);
    partial ||= result.summary.failedCount > 0;
    results.push(result);
  }
  for (const model of manifest.selectedModels) {
    if (!seen.has(model)) {
      partial = true;
      output(`${model}: NOT RUN; suite did not reach this model.`);
    }
  }
  if (results.length > 0) output(formatComparison(...results));
  else output("No model measurements are available.");
  const notes = notesPath === null ? null : JSON.parse(await readFile(notesPath, "utf8"));
  const analyses = notes === null ? null : Object.fromEntries(results.map((result) => [result.requestedModel, analyzeResult(result, notes)]));
  const analysisPath = resolve(dirname(manifestPath), "ollama-comparison.json");
  await writeFile(analysisPath, `${JSON.stringify({ dataset: manifest.dataset, partial, models: manifest.models, analyses }, null, 2)}\n`, "utf8");
  output(`Ollama comparison ${partial ? "INCOMPLETE" : "COMPLETE"}; ${results.length}/${manifest.selectedModels.length} models measured.`);
  output(`Offline analysis saved: ${analysisPath}`);
  return { ok: !partial, partial, results, analyses, analysisPath };
}
