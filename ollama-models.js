// One representative tag per checkpoint/size, checked against Ollama on 2026-10-19.
// Other quantizations and custom decision-capable tags can be selected explicitly.
export const OLLAMA_MODEL_CATALOG = Object.freeze([
  { model: "d1", size: "3B", note: "Existing baseline; GGUF." },
  { model: "tev1:0.8b", size: "0.8B", note: "GGUF; Ollama 0.35+." },
  { model: "tev1:4b", size: "4B", note: "GGUF; Ollama 0.35+." },
  { model: "nimble", size: "9B", note: "GGUF/MLX; Apache 2.0." },
  { model: "nimble-v3", size: "9B", note: "GGUF/MLX; Ollama 0.40.4+; noncommercial CC BY-NC 4.0." },
  { model: "laya", size: "421M", note: "English; Ollama 0.40+; default 512-token context rejects longer incidents." },
  { model: "laya:322m-multilingual-bf16", size: "322M", note: "Multilingual checkpoint; GGUF." },
  { model: "laya:421m-typed-decisions-bf16", size: "421M", note: "Typed-decisions checkpoint; GGUF." },
  { model: "clef-flash", size: "9B", note: "Text/image; Ollama 0.35.1+." },
  { model: "clef", size: "27B", note: "Text/image; Ollama 0.35.1+; larger memory requirement." },
  { model: "pplx-decider", size: "27B", note: "Text/image; GGUF; larger memory requirement." },
  { model: "kev:0.8b-q8_0", size: "0.8B", note: "Explicit GGUF tag; Ollama 0.40.4+." },
  { model: "kev:4b-q4_K_M", size: "4B", note: "Explicit GGUF tag; Ollama 0.40.4+." },
  { model: "kev:9b-q4_K_M", size: "9B", note: "Explicit GGUF tag; Ollama 0.40.4+." },
  { model: "kev:27b-nvfp4", size: "27B", note: "MLX; Apple silicon server required; Ollama 0.40.4+." },
  { model: "strands-decider", size: "2B", note: "MLX; Apple silicon server required; Ollama 0.40+." },
].map(Object.freeze));

export function parseOllamaModels(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("OLLAMA_EVAL_MODELS must be all or a comma-separated list of model names.");
  }
  if (value.trim() === "all") return OLLAMA_MODEL_CATALOG.map(({ model }) => model);
  const models = value.split(",").map((model) => model.trim());
  if (models.some((model) => !model || model === "all" || /\s/.test(model))) {
    throw new Error("OLLAMA_EVAL_MODELS must be all or a comma-separated list of model names without empty entries.");
  }
  return [...new Set(models)];
}

export function formatOllamaModels() {
  return OLLAMA_MODEL_CATALOG.map(({ model, size, note }) => `${model} (${size}): ${note}`).join("\n");
}
