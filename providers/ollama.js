import {
  ATTENTION_QUESTION,
  buildIncidentInput,
  CATEGORY_QUESTION,
  normalizeDecision,
} from "../decisions.js";

export const OLLAMA_TIMEOUT_MS = 120_000;

function questionInstructions(question) {
  return `${question.question}\n${question.instructions}`;
}

function buildQuestions() {
  return {
    [CATEGORY_QUESTION.name]: {
      type: "choice",
      instructions: questionInstructions(CATEGORY_QUESTION),
      criteria: Object.fromEntries(
        CATEGORY_QUESTION.options.map(({ value, description }) => [
          value,
          description,
        ]),
      ),
    },
    [ATTENTION_QUESTION.name]: {
      type: "noul",
      instructions: questionInstructions(ATTENTION_QUESTION),
      criteria: { ...ATTENTION_QUESTION.criteria },
    },
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readCategoryProbabilities(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("Ollama response has an invalid category probability map.");
  }

  return { ...value };
}

function readAttentionProbability(answer) {
  if (!Object.hasOwn(answer, "noul")) {
    return undefined;
  }
  return answer.noul;
}

function mapAnswers(payload) {
  if (!isRecord(payload) || !isRecord(payload.answers)) {
    throw new Error("Ollama response is missing its named answers object.");
  }

  const categoryAnswer = payload.answers[CATEGORY_QUESTION.name];
  const attentionAnswer = payload.answers[ATTENTION_QUESTION.name];
  if (!isRecord(categoryAnswer) || !isRecord(attentionAnswer)) {
    throw new Error("Ollama response is missing a required named answer.");
  }
  if (categoryAnswer.type !== "choice" || typeof categoryAnswer.choice !== "string") {
    throw new Error("Ollama category answer must contain a selected choice.");
  }
  if (attentionAnswer.type !== "noul") {
    throw new Error("Ollama attention answer must be a noul answer.");
  }

  return normalizeDecision({
    category: categoryAnswer.choice,
    categoryProbabilities: readCategoryProbabilities(categoryAnswer.probabilities),
    requiresAttentionProbability: readAttentionProbability(attentionAnswer),
  });
}

function errorForStatus(status) {
  if (status === 404) {
    return new Error(
      "Ollama returned HTTP 404. Check that the configured model is installed and this server supports /v1/systemone.",
    );
  }
  return new Error(`Ollama decision request failed with HTTP ${status}.`);
}

export async function requestOllamaDecision({
  incident,
  model,
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = OLLAMA_TIMEOUT_MS,
  onResponseMetadata,
}) {
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("Ollama model must be a nonempty string.");
  }
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("Ollama base URL must be a nonempty string.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Ollama fetch implementation must be a function.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Ollama request timeout must be a positive integer in milliseconds.");
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/systemone`;
  const body = {
    model,
    state: buildIncidentInput(incident),
    questions: buildQuestions(),
  };

  let response;
  let responseText;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      responseText = await response.text();
    }
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Ollama decision request timed out after ${timeoutMs} ms.`, { cause: error });
    }
    const message = response
      ? "Ollama connection failed while reading the decision response."
      : "Could not connect to Ollama. Check OLLAMA_BASE_URL and confirm the server is running.";
    throw new Error(message, { cause: error });
  }

  if (!response.ok) {
    throw errorForStatus(response.status);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error("Ollama returned invalid JSON from /v1/systemone.", { cause: error });
  }

  if (typeof onResponseMetadata === "function") {
    onResponseMetadata({ model: payload?.model });
  }

  try {
    return mapAnswers(payload);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ollama ")) {
      throw error;
    }
    throw new Error(`Ollama returned an invalid decision: ${error.message}`, { cause: error });
  }
}
