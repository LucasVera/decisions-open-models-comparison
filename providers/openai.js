import {
  ATTENTION_QUESTION,
  buildIncidentInput,
  CATEGORY_QUESTION,
  normalizeDecision,
} from "../decisions.js";

export const OPENAI_DECISIONS_URL = "https://api.openai.com/v1/decisions";
export const OPENAI_TIMEOUT_MS = 120_000;

function questionInstructions(question) {
  return `${question.question}\n${question.instructions}`;
}

function buildQuestions() {
  const attentionInstructions = [
    questionInstructions(ATTENTION_QUESTION),
    `True: ${ATTENTION_QUESTION.criteria.true}`,
    `False: ${ATTENTION_QUESTION.criteria.false}`,
  ].join("\n");

  return [
    {
      type: "choice",
      name: CATEGORY_QUESTION.name,
      instructions: questionInstructions(CATEGORY_QUESTION),
      choices: CATEGORY_QUESTION.options.map(({ value, description }) => ({
        value,
        description,
      })),
    },
    {
      type: "predicate",
      name: ATTENTION_QUESTION.name,
      instructions: attentionInstructions,
    },
  ];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readCategoryProbabilities(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error("OpenAI response has an invalid category probability list.");
  }

  const probabilities = Object.create(null);
  for (const item of value) {
    if (!isRecord(item) || typeof item.value !== "string") {
      throw new Error("OpenAI response has an invalid category probability entry.");
    }
    if (Object.hasOwn(probabilities, item.value)) {
      throw new Error(`OpenAI response repeats a probability for ${item.value}.`);
    }
    probabilities[item.value] = item.probability;
  }
  return probabilities;
}

function readAttentionProbability(answer) {
  if (!Object.hasOwn(answer, "probability")) {
    return undefined;
  }
  return answer.probability;
}

function answersByName(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.answers)) {
    throw new Error("OpenAI response is missing its answers array.");
  }

  if (payload.answers.some((answer) => isRecord(answer) && answer.type === "refusal")) {
    throw new Error("OpenAI refused one or more decisions.");
  }

  const requiredNames = new Set([
    CATEGORY_QUESTION.name,
    ATTENTION_QUESTION.name,
  ]);
  const answers = new Map();
  for (const answer of payload.answers) {
    if (!isRecord(answer) || typeof answer.name !== "string") {
      throw new Error("OpenAI response contains an invalid named answer.");
    }
    if (!requiredNames.has(answer.name)) {
      continue;
    }
    if (answers.has(answer.name)) {
      throw new Error(`OpenAI response repeats the ${answer.name} answer.`);
    }
    answers.set(answer.name, answer);
  }

  const categoryAnswer = answers.get(CATEGORY_QUESTION.name);
  const attentionAnswer = answers.get(ATTENTION_QUESTION.name);
  if (!categoryAnswer || !attentionAnswer) {
    throw new Error("OpenAI response is missing a required named answer.");
  }
  if (categoryAnswer.type !== "choice" || typeof categoryAnswer.choice !== "string") {
    throw new Error("OpenAI category answer must contain a selected choice.");
  }
  if (attentionAnswer.type !== "predicate") {
    throw new Error("OpenAI attention answer must be a predicate answer.");
  }

  return { categoryAnswer, attentionAnswer };
}

function mapAnswers(payload) {
  const { categoryAnswer, attentionAnswer } = answersByName(payload);
  return normalizeDecision({
    category: categoryAnswer.choice,
    categoryProbabilities: readCategoryProbabilities(categoryAnswer.probabilities),
    requiresAttentionProbability: readAttentionProbability(attentionAnswer),
  });
}

function errorForStatus(status) {
  if (status === 401) {
    return new Error("OpenAI rejected the API key. Check OPENAI_API_KEY.");
  }
  if (status === 403) {
    return new Error("OpenAI denied access to the Decisions API or configured model.");
  }
  if (status === 404) {
    return new Error("OpenAI could not find the Decisions endpoint or configured model.");
  }
  if (status === 429) {
    return new Error("OpenAI rate limit or quota was reached.");
  }
  return new Error(`OpenAI decision request failed with HTTP ${status}.`);
}

export async function requestOpenAIDecision({
  incident,
  model,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = OPENAI_TIMEOUT_MS,
  onResponseMetadata,
}) {
  if (typeof model !== "string" || model.trim() === "") {
    throw new Error("OpenAI model must be a nonempty string.");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new Error("OpenAI API key must be a nonempty string.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("OpenAI fetch implementation must be a function.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("OpenAI request timeout must be a positive integer in milliseconds.");
  }

  const body = {
    model,
    input: buildIncidentInput(incident),
    questions: buildQuestions(),
  };

  let response;
  let responseText;
  try {
    response = await fetchImpl(OPENAI_DECISIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      responseText = await response.text();
    }
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`OpenAI decision request timed out after ${timeoutMs} ms.`, { cause: error });
    }
    const message = response
      ? "OpenAI connection failed while reading the decision response."
      : "Could not connect to the OpenAI Decisions API.";
    throw new Error(message, { cause: error });
  }

  if (!response.ok) {
    throw errorForStatus(response.status);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error("OpenAI returned invalid JSON from /v1/decisions.", { cause: error });
  }

  if (typeof onResponseMetadata === "function") {
    onResponseMetadata({ model: payload?.model });
  }

  try {
    return mapAnswers(payload);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("OpenAI ")) {
      throw error;
    }
    throw new Error(`OpenAI returned an invalid decision: ${error.message}`, { cause: error });
  }
}
