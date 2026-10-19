import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";

const ENVIRONMENT_KEYS = [
  "MODEL_PROVIDER",
  "OLLAMA_MODEL",
  "OLLAMA_EVAL_MODELS",
  "OLLAMA_MODELS",
  "OLLAMA_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_API_KEY",
];

function withEnvironment(values, action) {
  const previous = new Map(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  const originalLoadEnvFile = process.loadEnvFile;
  process.loadEnvFile = () => {};
  for (const key of ENVIRONMENT_KEYS) {
    if (Object.hasOwn(values, key)) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    } else {
      delete process.env[key];
    }
  }

  try {
    return action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.loadEnvFile = originalLoadEnvFile;
  }
}

test("configuration defaults to Ollama without requiring an OpenAI key", () => {
  const config = withEnvironment({}, () => loadConfig());
  assert.deepEqual(config, {
    provider: "ollama",
    model: "d1",
    baseUrl: "http://localhost:11434",
  });
});

test("changing only MODEL_PROVIDER selects OpenAI when its settings are present", () => {
  const common = {
    OLLAMA_MODEL: "d1",
    OLLAMA_BASE_URL: "http://localhost:11434",
    OPENAI_MODEL: "gpt-6-luna",
    OPENAI_API_KEY: "sk-test-config-key",
  };

  const configs = withEnvironment(common, () => {
    const ollama = loadConfig();
    process.env.MODEL_PROVIDER = "openai";
    return [ollama, loadConfig()];
  });

  assert.equal(configs[0].provider, "ollama");
  assert.equal(configs[1].provider, "openai");
  assert.equal(configs[1].model, "gpt-6-luna");
  assert.equal(configs[1].apiKey, "sk-test-config-key");
});

test("configuration rejects unsupported providers, missing OpenAI keys, and invalid settings", () => {
  withEnvironment({ MODEL_PROVIDER: "other" }, () => {
    assert.throws(() => loadConfig(), /MODEL_PROVIDER must be either/);
  });

  withEnvironment({ MODEL_PROVIDER: "openai" }, () => {
    assert.throws(() => loadConfig(), /OPENAI_API_KEY is required/);
  });

  withEnvironment({ OLLAMA_MODEL: "  " }, () => {
    assert.throws(() => loadConfig(), /OLLAMA_MODEL must be a nonempty model name/);
  });

  withEnvironment({ OLLAMA_BASE_URL: "ftp://localhost:11434" }, () => {
    assert.throws(() => loadConfig(), /absolute HTTP or HTTPS URL/);
  });
});

test("Ollama suite selection supports all, explicit tags, and provider isolation", () => {
  withEnvironment({ OLLAMA_MODELS: "D:\\Ollama\\models" }, () => {
    assert.equal(loadConfig().models, undefined);
    assert.equal(loadConfig().model, "d1");
  });
  withEnvironment({ OLLAMA_EVAL_MODELS: " d1, tev1:4b,d1, vendor/custom:q4 " }, () => {
    assert.deepEqual(loadConfig().models, ["d1", "tev1:4b", "vendor/custom:q4"]);
  });
  withEnvironment({ OLLAMA_EVAL_MODELS: "all" }, () => {
    const { models } = loadConfig();
    assert.ok(models.includes("d1"));
    assert.ok(models.includes("tev1:0.8b"));
    assert.ok(models.includes("tev1:4b"));
    assert.ok(models.includes("strands-decider"));
  });
  withEnvironment({ OLLAMA_EVAL_MODELS: "d1,,nimble" }, () => {
    assert.throws(() => loadConfig(), /without empty entries/);
    assert.deepEqual(loadConfig({ ollamaModels: "d1,nimble" }).models, ["d1", "nimble"]);
  });
  withEnvironment({ OLLAMA_EVAL_MODELS: "  " }, () => {
    assert.equal(loadConfig().models, undefined);
  });
  withEnvironment({ MODEL_PROVIDER: "openai", OPENAI_API_KEY: "sk-fixture", OLLAMA_EVAL_MODELS: "d1,,nimble" }, () => {
    assert.equal(loadConfig().models, undefined);
    assert.equal(loadConfig().model, "gpt-6-luna");
  });
});
