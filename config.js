import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOllamaModels } from "./ollama-models.js";

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const envFilePath = resolve(projectDirectory, ".env");

function loadEnvironmentFile() {
  try {
    process.loadEnvFile(envFilePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error("Could not load the project .env file.", { cause: error });
    }
  }
}

function readModel(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a nonempty model name.`);
  }
  return value.trim();
}

function readOllamaBaseUrl() {
  const value = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("OLLAMA_BASE_URL must be an absolute HTTP or HTTPS URL.");
  }

  if (
    !["http:", "https:"].includes(url.protocol)
    || !url.hostname
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error("OLLAMA_BASE_URL must be an absolute HTTP or HTTPS URL without credentials, query, or fragment.");
  }

  return url.href.replace(/\/+$/, "");
}

export function loadConfig({ ollamaModels } = {}) {
  loadEnvironmentFile();

  const provider = process.env.MODEL_PROVIDER ?? "ollama";
  if (provider !== "ollama" && provider !== "openai") {
    throw new Error('MODEL_PROVIDER must be either "ollama" or "openai".');
  }

  if (provider === "ollama") {
    const selection = ollamaModels ?? process.env.OLLAMA_EVAL_MODELS;
    return {
      provider,
      model: readModel("OLLAMA_MODEL", "d1"),
      baseUrl: readOllamaBaseUrl(),
      ...(selection?.trim() ? { models: parseOllamaModels(selection) } : {}),
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("OPENAI_API_KEY is required when MODEL_PROVIDER is openai.");
  }

  return {
    provider,
    model: readModel("OPENAI_MODEL", "gpt-6-luna"),
    apiKey: apiKey.trim(),
  };
}
