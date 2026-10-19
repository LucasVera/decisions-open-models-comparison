const freezeOptions = (options) =>
  Object.freeze(options.map((option) => Object.freeze(option)));

export const CATEGORY_QUESTION = Object.freeze({
  name: "category",
  question: "Which category best describes the primary cause of this incident?",
  instructions:
    "Select the best-supported primary cause from the evidence. Prefer a specific rate-limit or access failure over a generic downstream symptom. Use other when the evidence is insufficient.",
  options: freezeOptions([
    {
      value: "throttling",
      description:
        "Requests or work are limited by a rate, quota, throughput, or concurrency limit.",
    },
    {
      value: "authentication",
      description:
        "Identity, credentials, tokens, signatures, or access permissions prevent the operation. Include authorization failures in this category.",
    },
    {
      value: "dependency_failure",
      description:
        "A downstream service or dependency is unavailable, failing, or timing out, without stronger evidence for throttling or access failure as the cause.",
    },
    {
      value: "other",
      description:
        "The evidence points to another cause or does not support any of the categories above.",
    },
  ]),
});

export const ATTENTION_QUESTION = Object.freeze({
  name: "requires_attention",
  question: "Does this incident require immediate attention?",
  instructions:
    "Decide from customer impact and available evidence. Do not infer an outage from an error name alone.",
  criteria: Object.freeze({
    true: "Investigate now because evidence indicates ongoing or imminent material customer harm, such as blocked requests, sustained errors, or a growing processing backlog.",
    false:
      "A recovered isolated error, controlled test, or brief retry without material impact generally does not require immediate attention.",
  }),
});

export const ATTENTION_THRESHOLD = 0.5;
export const PROBABILITY_SUM_TOLERANCE = 1e-6;

const CATEGORY_VALUES = new Set(CATEGORY_QUESTION.options.map(({ value }) => value));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateProbability(value, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError(`${label} must be a finite number between 0 and 1.`);
  }
}

export function normalizeCategoryProbabilities(value) {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new TypeError("Decision category probabilities must be an object or unavailable.");
  }

  const probabilities = {};
  let sum = 0;
  for (const [category, probability] of Object.entries(value)) {
    if (!CATEGORY_VALUES.has(category)) {
      throw new TypeError(`Decision has an unknown category probability: ${category}.`);
    }
    validateProbability(probability, `Probability for ${category}`);
    probabilities[category] = probability;
    sum += probability;
  }
  const complete = Object.keys(probabilities).length === CATEGORY_VALUES.size;
  if (sum > 1 + PROBABILITY_SUM_TOLERANCE || (complete && Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE)) {
    throw new TypeError(`Category probability sum ${sum} is invalid for a ${complete ? "complete" : "partial"} map.`);
  }
  return probabilities;
}

export function normalizeDecision({
  category,
  categoryProbabilities,
  requiresAttentionProbability,
}) {
  if (typeof category !== "string" || !CATEGORY_VALUES.has(category)) {
    throw new TypeError("Decision has an unknown or missing category.");
  }
  const normalizedCategoryProbabilities = normalizeCategoryProbabilities(categoryProbabilities);

  let normalizedAttentionProbability = null;
  let requiresAttention = null;
  if (requiresAttentionProbability !== undefined) {
    validateProbability(requiresAttentionProbability, "Attention probability");
    normalizedAttentionProbability = requiresAttentionProbability;
    requiresAttention = normalizedAttentionProbability >= ATTENTION_THRESHOLD;
  }

  return {
    category,
    categoryProbabilities: normalizedCategoryProbabilities,
    requiresAttentionProbability: normalizedAttentionProbability,
    requiresAttention,
  };
}

export function buildIncidentInput(incident) {
  if (!incident || typeof incident !== "object") {
    throw new TypeError("Incident must be an object with an ID and description.");
  }

  if (typeof incident.id !== "string" || incident.id.trim() === "") {
    throw new TypeError("Incident ID must be a nonempty string.");
  }

  if (
    typeof incident.description !== "string" ||
    incident.description.trim() === ""
  ) {
    throw new TypeError("Incident description must be a nonempty string.");
  }

  return `Incident ID: ${incident.id}\nDescription:\n${incident.description}`;
}
