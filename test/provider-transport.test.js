import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { requestOllamaDecision } from "../providers/ollama.js";
import { requestOpenAIDecision } from "../providers/openai.js";

const incident = { id: "transport-check", description: "Synthetic incident evidence." };
const apiKey = "sk-test-transport-do-not-print";

async function serve(t, handleRequest) {
  const server = createServer(handleRequest);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

const providers = [
  {
    name: "Ollama",
    request: (baseUrl, options) => requestOllamaDecision({
      incident,
      model: "d1",
      baseUrl,
      ...options,
    }),
  },
  {
    name: "OpenAI",
    request: (baseUrl, options) => requestOpenAIDecision({
      incident,
      model: "gpt-6-luna",
      apiKey,
      ...options,
      fetchImpl: (_url, fetchOptions) => options.fetchImpl(baseUrl, fetchOptions),
    }),
  },
];

for (const provider of providers) {
  test(`${provider.name} times out before response headers arrive`, { timeout: 5_000 }, async (t) => {
    const baseUrl = await serve(t, (request) => request.resume());
    let receivedHeaders = false;
    await assert.rejects(
      provider.request(baseUrl, {
        timeoutMs: 100,
        fetchImpl: async (url, options) => {
          const response = await fetch(url, options);
          receivedHeaders = true;
          return response;
        },
      }),
      (error) => {
        assert.equal(receivedHeaders, false);
        assert.match(error.message, new RegExp(`${provider.name} decision request timed out after 100 ms`));
        assert.equal(error.message.includes(apiKey), false);
        return true;
      },
    );
  });

  test(`${provider.name} times out while reading a stalled response body`, { timeout: 5_000 }, async (t) => {
    const baseUrl = await serve(t, (request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
    });
    let receivedHeaders = false;
    let signal;
    await assert.rejects(
      provider.request(baseUrl, {
        timeoutMs: 500,
        fetchImpl: async (url, options) => {
          signal = options.signal;
          const response = await fetch(url, options);
          receivedHeaders = true;
          return response;
        },
      }),
      (error) => {
        assert.equal(receivedHeaders, true);
        assert.equal(signal.aborted, true);
        assert.match(error.message, new RegExp(`${provider.name} decision request timed out after 500 ms`));
        assert.equal(error.message.includes(apiKey), false);
        return true;
      },
    );
  });

  test(`${provider.name} reports a connection failure when the response body is interrupted`, { timeout: 5_000 }, async (t) => {
    let interruptResponse;
    const baseUrl = await serve(t, (request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"answers":');
      interruptResponse = () => response.destroy();
    });
    let receivedHeaders = false;
    await assert.rejects(
      provider.request(baseUrl, {
        fetchImpl: async (url, options) => {
          const response = await fetch(url, options);
          receivedHeaders = true;
          interruptResponse();
          return response;
        },
      }),
      (error) => {
        assert.equal(receivedHeaders, true);
        assert.match(error.message, new RegExp(`${provider.name} connection failed while reading`));
        assert.equal(error.message.includes(apiKey), false);
        return true;
      },
    );
  });
}
