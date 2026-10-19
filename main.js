import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { DATASET_PATH, RESULTS_DIRECTORY, runEvaluation } from "./evaluation.js";
import { formatOllamaModels } from "./ollama-models.js";
import { compareOllamaSuite, runOllamaSuite } from "./ollama-suite.js";

export { DATASET_PATH, RESULTS_DIRECTORY, runEvaluation };

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--list-models") {
    console.log(formatOllamaModels());
    return;
  }
  if (args.length === 1 && args[0] === "--compare-models") {
    const outcome = await compareOllamaSuite();
    if (!outcome.ok) process.exitCode = 1;
    return outcome;
  }
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--models")) {
    throw new Error("Usage: node main.js [--list-models | --models all|name,name | --compare-models]");
  }
  const config = loadConfig({ ollamaModels: args[1] });
  if (args.length > 0) {
    if (config.provider !== "ollama") throw new Error("--models requires MODEL_PROVIDER=ollama.");
  }
  const outcome = config.provider === "ollama" && config.models
    ? await runOllamaSuite({ config })
    : await runEvaluation({ config });
  if (outcome.manifest) await compareOllamaSuite({ manifestPath: outcome.manifestPath });
  if (outcome.hasFailures) {
    process.exitCode = 1;
  }
  return outcome;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Evaluation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
