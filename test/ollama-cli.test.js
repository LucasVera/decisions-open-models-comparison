import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("CLI selects suites, preserves single-model usage, and compares offline without provider settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ollama-cli-"));
  assert.equal(dirname(directory), resolve(tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["main.js", "package.json", "config.js", "ollama-models.js", "ollama-suite.js",
    "evaluation.js", "compare.js", "analysis.js", "decisions.js", "providers", "data/incidents.json", "data/incident-notes.json"]) {
    await cp(join(root, name), join(directory, name), { recursive: true });
  }
  const dataset = JSON.parse(await readFile(join(directory, "data/incidents.json"), "utf8"));
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    calls.push({ url: request.url, payload });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/show") {
      response.statusCode = payload.model === "missing" ? 404 : 200;
      response.end(JSON.stringify({ capabilities: ["decision"], details: { format: "gguf" } }));
      return;
    }
    response.end(JSON.stringify({ model: payload.model, answers: {
      category: { type: "choice", choice: "other", probabilities: { other: 0.812345678901 } },
      requires_attention: { type: "noul", noul: 0.5 },
    } }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const env = { ...process.env, MODEL_PROVIDER: "ollama", OLLAMA_MODEL: "fixture/one:tag",
    OLLAMA_EVAL_MODELS: "", OLLAMA_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  const run = async (args, overrides = {}) => {
    try {
      const result = await execute(process.execPath, [join(directory, "main.js"), ...args], {
        cwd: directory, env: { ...env, ...overrides }, timeout: 20_000,
      });
      return { ...result, code: 0 };
    } catch (error) {
      return error;
    }
  };
  const listed = await run(["--list-models"], { MODEL_PROVIDER: "invalid" });
  assert.equal(listed.code, 0);
  assert.match(listed.stdout, /strands-decider/);
  assert.equal(calls.length, 0);
  const selected = await run(["--models", "fixture/one:tag,missing,fixture/two:tag"], { OLLAMA_EVAL_MODELS: "ignored,,invalid" });
  assert.equal(selected.code, 1);
  assert.match(selected.stdout, /INCOMPLETE/);
  const requests = calls.filter(({ url }) => url === "/v1/systemone");
  assert.equal(requests.length, dataset.length * 2);
  assert.deepEqual(requests.slice(0, dataset.length).map(({ payload }) => payload.state),
    requests.slice(dataset.length).map(({ payload }) => payload.state));
  assert.equal(calls.filter(({ url }) => url === "/api/show").length, 3);
  const beforeCompare = calls.length;
  const compared = await run(["--compare-models"], { MODEL_PROVIDER: "invalid", OLLAMA_BASE_URL: "invalid" });
  assert.equal(compared.code, 1);
  assert.match(compared.stdout, /fixture\/two:tag/);
  assert.match(compared.stdout, /no measured accuracy or latency/);
  assert.equal(calls.length, beforeCompare);
  const openai = await run(["--models", "all"], { MODEL_PROVIDER: "openai", OPENAI_API_KEY: "sk-fixture-only" });
  assert.equal(openai.code, 1);
  assert.match(openai.stderr, /--models requires MODEL_PROVIDER=ollama/);
  assert.equal(calls.length, beforeCompare);
  const single = await run([]);
  assert.equal(single.code, 0);
  const saved = JSON.parse(await readFile(join(directory, "results/ollama.json"), "utf8"));
  assert.equal(saved.requestedModel, "fixture/one:tag");
  assert.equal(saved.incidents.length, dataset.length);
});
