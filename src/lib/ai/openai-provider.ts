import {
  createMockSuggestionAdapter,
  suggestReimbursementCandidateWithMockProvider,
  suggestTransactionWithMockProvider
} from "./mock-provider";
import type {
  AiSuggestionAdapter,
  AiSuggestionProviderDescriptor,
  CategorySuggestion,
  ReimbursementCandidateAiRequest,
  ReimbursementCandidateAiSuggestion,
  TransactionAiSuggestion,
  TransactionSuggestionRequest
} from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Stronger default model for a smarter, more accurate AI product. Overridable
// per-deploy with OPENAI_MODEL (e.g. a dated snapshot or a -mini variant) — if
// the configured id is unavailable the call fails closed and we fall back to the
// deterministic heuristic baseline, so a bad id degrades quality but never crashes.
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const OPENAI_PROVIDER_VERSION = "openai-suggestions-v3";
const OPENAI_REQUEST_TIMEOUT_MS = 30_000;
const MERCHANT_RULE_SHORT_CIRCUIT_CONFIDENCE = 0.85;

// Reasoning effort for the Responses API on reasoning-capable models. The user
// wants a smarter product over raw latency/cost, so categorization runs at "low"
// (high volume, still a real reasoning pass) and the reimbursement judgment runs
// at "medium" (low volume, benefits most from deliberate reasoning). A single
// OPENAI_REASONING_EFFORT override applies to both when set.
const DEFAULT_CATEGORIZATION_REASONING_EFFORT = "low";
const DEFAULT_REIMBURSEMENT_REASONING_EFFORT = "medium";

function resolveReasoningEffort(fallback: string) {
  return process.env.OPENAI_REASONING_EFFORT?.trim() || fallback;
}

export const OPENAI_AI_SUGGESTION_PROVIDER: AiSuggestionProviderDescriptor = {
  id: "openai-transaction-review",
  kind: "openai",
  label: "OpenAI transaction review",
  version: OPENAI_PROVIDER_VERSION
};

interface OpenAiSuggestionAdapterOptions {
  apiKey?: string;
  model?: string;
  fallback?: AiSuggestionAdapter;
}

interface OpenAiSuggestionPayload {
  merchantName?: unknown;
  categoryName?: unknown;
  intent?: unknown;
  recurring?: unknown;
  confidence?: unknown;
  reason?: unknown;
  signals?: unknown;
}

interface OpenAiResponseBody {
  error?: {
    message?: unknown;
    type?: unknown;
  } | null;
  incomplete_details?: {
    reason?: unknown;
  } | null;
  output?: unknown;
  output_text?: unknown;
  status?: unknown;
}

type SupportedIntent = TransactionAiSuggestion["intent"]["value"];

const SUPPORTED_INTENTS = new Set<SupportedIntent>(["business", "personal", "reimbursable", "shared", "transfer"]);
const REVIEWABLE_CATEGORY_FALLBACK_CONFIDENCE = 0.64;
const PREFERRED_CONCRETE_FALLBACK_CATEGORIES = ["Shopping", "Food", "Groceries", "Entertainment"];

function assertServerRuntime() {
  if (typeof window !== "undefined") {
    throw new Error("OpenAI suggestion provider can only run on the server.");
  }
}

function configuredApiKey(apiKey?: string) {
  return apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export function getOpenAiSuggestionModel(model?: string) {
  return model?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function isOpenAiSuggestionConfigured(apiKey?: string) {
  assertServerRuntime();
  return Boolean(configuredApiKey(apiKey));
}

export function createOpenAiSuggestionAdapter(options: OpenAiSuggestionAdapterOptions = {}): AiSuggestionAdapter {
  assertServerRuntime();

  const apiKey = configuredApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to create the OpenAI suggestion provider.");
  }

  const model = getOpenAiSuggestionModel(options.model);
  const fallback = options.fallback ?? createMockSuggestionAdapter();
  const suggestWithProvider = async (request: TransactionSuggestionRequest) => {
    const baseline = await fallback.suggestTransaction(request);

    // Token-saving short-circuit: if a saved merchant rule already produced a
    // high-confidence answer, the OpenAI call would only echo it. Skip it.
    if (
      baseline.category.source === "merchant-rule" &&
      baseline.confidence >= MERCHANT_RULE_SHORT_CIRCUIT_CONFIDENCE
    ) {
      return baseline;
    }

    try {
      return await suggestTransactionWithOpenAi({ apiKey, baseline, model, request });
    } catch (error) {
      console.warn(`openai_suggestion_failed model=${model}: ${sanitizeOpenAiError(error)}`);
      return baseline;
    }
  };

  return {
    descriptor: {
      ...OPENAI_AI_SUGGESTION_PROVIDER,
      version: `${OPENAI_PROVIDER_VERSION}:${model}`
    },
    async suggestReimbursementCandidate(request) {
      const baseline = fallback.suggestReimbursementCandidate
        ? await fallback.suggestReimbursementCandidate(request)
        : suggestReimbursementCandidateWithMockProvider(request);

      try {
        return await suggestReimbursementCandidateWithOpenAi({ apiKey, baseline, model, request });
      } catch (error) {
        console.warn(`openai_reimbursement_candidate_failed model=${model}: ${sanitizeOpenAiError(error)}`);
        return baseline;
      }
    },
    suggestTransaction: suggestWithProvider,
    async suggestTransactions(requests) {
      return Promise.all(requests.map(suggestWithProvider));
    }
  };
}

async function suggestReimbursementCandidateWithOpenAi({
  apiKey,
  baseline,
  model,
  request
}: {
  apiKey: string;
  baseline: ReimbursementCandidateAiSuggestion;
  model: string;
  request: ReimbursementCandidateAiRequest;
}): Promise<ReimbursementCandidateAiSuggestion> {
  const payload = await callOpenAiReimbursementCandidate({ apiKey, baseline, model, request });
  const confidence = coerceConfidence(payload.confidence, baseline.confidence);
  const suggestedIntent = payload.suggestedIntent === "shared" || payload.suggestedIntent === "reimbursable"
    ? payload.suggestedIntent
    : baseline.suggestedIntent;
  const suggestedInflowIds = coerceKnownIds(
    payload.suggestedInflowIds,
    request.candidateInflows.map((inflow) => inflow.id),
    baseline.suggestedInflowIds
  );
  const question = coerceString(payload.question) ?? baseline.question;
  const reason = coerceString(payload.reason) ?? baseline.reason;
  const signals = coerceSignals(payload.signals, baseline.signals);

  return {
    ...baseline,
    suggestionId: `openai-${baseline.suggestionId}`,
    provider: {
      ...OPENAI_AI_SUGGESTION_PROVIDER,
      version: `${OPENAI_PROVIDER_VERSION}:${model}`
    },
    suggestedIntent,
    suggestedInflowIds,
    confidence,
    question,
    reason,
    signals
  };
}

interface OpenAiReimbursementCandidatePayload {
  confidence?: unknown;
  question?: unknown;
  reason?: unknown;
  signals?: unknown;
  suggestedInflowIds?: unknown;
  suggestedIntent?: unknown;
}

async function callOpenAiReimbursementCandidate({
  apiKey,
  baseline,
  model,
  request
}: {
  apiKey: string;
  baseline: ReimbursementCandidateAiSuggestion;
  model: string;
  request: ReimbursementCandidateAiRequest;
}): Promise<OpenAiReimbursementCandidatePayload> {
  const isReasoningModel = /^(o\d|gpt-5)/i.test(model);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    input: [
      {
        content: [{ text: buildReimbursementCandidateSystemPrompt(), type: "input_text" }],
        role: "system"
      },
      {
        content: [{ text: buildReimbursementCandidateUserPrompt(request, baseline), type: "input_text" }],
        role: "user"
      }
    ],
    max_output_tokens: isReasoningModel ? 4000 : 600,
    model,
    text: {
      format: {
        type: "json_schema",
        name: "reimbursement_candidate_suggestion",
        description: "A concise reimbursement candidate review suggestion for a personal finance ledger.",
        strict: false,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["suggestedIntent", "suggestedInflowIds", "confidence", "question", "reason"],
          properties: {
            suggestedIntent: { enum: ["shared", "reimbursable"], type: "string" },
            suggestedInflowIds: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            },
            confidence: { maximum: 1, minimum: 0, type: "number" },
            question: { type: "string" },
            reason: { type: "string" },
            signals: {
              type: "array",
              items: { type: "string" },
              maxItems: 5
            }
          }
        }
      }
    }
  };

  if (isReasoningModel) {
    body.reasoning = { effort: resolveReasoningEffort(DEFAULT_REIMBURSEMENT_REASONING_EFFORT) };
  }

  if (request.cacheKey) {
    body.prompt_cache_key = request.cacheKey;
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI reimbursement candidate request failed with ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json() as OpenAiResponseBody;
  if (data.status && data.status !== "completed") {
    const reason = coerceString(data.incomplete_details?.reason) ?? coerceString(data.error?.message);
    throw new Error(`OpenAI reimbursement candidate response ended with status ${String(data.status)}${reason ? `: ${reason}` : ""}.`);
  }

  const outputText = typeof data.output_text === "string" ? data.output_text : extractOutputText(data);
  if (!outputText) {
    throw new Error("OpenAI reimbursement candidate response had no output text.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(
      `OpenAI reimbursement candidate response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as OpenAiReimbursementCandidatePayload)
    : {};
}

async function suggestTransactionWithOpenAi({
  apiKey,
  baseline,
  model,
  request
}: {
  apiKey: string;
  baseline: TransactionAiSuggestion;
  model: string;
  request: TransactionSuggestionRequest;
}): Promise<TransactionAiSuggestion> {
  const payload = await callOpenAi({ apiKey, baseline, model, request });
  const categoryResult = coerceCategory(payload.categoryName, request, baseline.category.value);
  const category = categoryResult.category;
  const intent = coerceIntent(payload.intent, baseline.intent.value);
  const payloadConfidence = coerceConfidence(payload.confidence, baseline.confidence);
  const confidence = categoryResult.usedFallback
    ? Math.min(payloadConfidence, baseline.confidence, REVIEWABLE_CATEGORY_FALLBACK_CONFIDENCE)
    : payloadConfidence;
  const merchantName = coerceString(payload.merchantName) ?? baseline.merchantCleanup.value.normalized;
  const reason = categoryResult.usedFallback
    ? "OpenAI returned no concrete category; using a low-confidence fallback for review."
    : coerceString(payload.reason) ?? baseline.reason;
  const signals = categoryResult.usedFallback
    ? [...coerceSignals(payload.signals, baseline.signals), "openai category fallback"].slice(0, 5)
    : coerceSignals(payload.signals, baseline.signals);
  const recurring = typeof payload.recurring === "boolean" ? payload.recurring : baseline.recurring?.value;

  return {
    ...baseline,
    suggestionId: `openai-${baseline.suggestionId}`,
    provider: {
      ...OPENAI_AI_SUGGESTION_PROVIDER,
      version: `${OPENAI_PROVIDER_VERSION}:${model}`
    },
    merchantCleanup: {
      value: {
        original: baseline.merchantCleanup.value.original,
        normalized: merchantName
      },
      confidence,
      source: "openai",
      reason
    },
    category: {
      value: category,
      confidence,
      source: "openai",
      reason
    },
    intent: {
      value: intent,
      confidence,
      source: "openai",
      reason
    },
    recurring: recurring === undefined
      ? undefined
      : {
        value: recurring,
        confidence,
        source: "openai",
        reason
      },
    confidence,
    reason,
    signals
  };
}

async function callOpenAi({
  apiKey,
  baseline,
  model,
  request
}: {
  apiKey: string;
  baseline: TransactionAiSuggestion;
  model: string;
  request: TransactionSuggestionRequest;
}): Promise<OpenAiSuggestionPayload> {
  const isReasoningModel = /^(o\d|gpt-5)/i.test(model);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    input: [
      {
        content: [{ text: buildSystemPrompt(request), type: "input_text" }],
        role: "system"
      },
      {
        content: [{ text: buildUserPrompt(request, baseline), type: "input_text" }],
        role: "user"
      }
    ],
    max_output_tokens: isReasoningModel ? 4000 : 600,
    model,
    text: {
      format: {
        type: "json_schema",
        name: "transaction_suggestion",
        description: "A concise transaction cleanup suggestion for a personal finance ledger.",
        strict: false,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["merchantName", "categoryName", "intent", "recurring", "confidence", "reason"],
          properties: {
            merchantName: { type: "string" },
            categoryName: { type: "string" },
            intent: { enum: ["business", "personal", "reimbursable", "shared", "transfer"], type: "string" },
            recurring: { type: "boolean" },
            confidence: { maximum: 1, minimum: 0, type: "number" },
            reason: { type: "string" }
          }
        }
      }
    }
  };

  if (isReasoningModel) {
    body.reasoning = { effort: resolveReasoningEffort(DEFAULT_CATEGORIZATION_REASONING_EFFORT) };
  }

  if (request.cacheKey) {
    body.prompt_cache_key = request.cacheKey;
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI suggestion request failed with ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json() as OpenAiResponseBody;
  if (data.status && data.status !== "completed") {
    const reason = coerceString(data.incomplete_details?.reason) ?? coerceString(data.error?.message);
    throw new Error(`OpenAI suggestion response ended with status ${String(data.status)}${reason ? `: ${reason}` : ""}.`);
  }

  const outputText = typeof data.output_text === "string" ? data.output_text : extractOutputText(data);
  if (!outputText) {
    throw new Error("OpenAI suggestion response had no output text.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(
      `OpenAI suggestion response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as OpenAiSuggestionPayload)
    : {};
}

function buildSystemPrompt(request: TransactionSuggestionRequest) {
  const categoryList = (request.categories ?? [])
    .map((category) => category.name)
    .filter((name) => name && name.toLowerCase() !== "uncategorized")
    .slice(0, 60);

  const merchantRules = (request.merchantRules ?? [])
    .filter((rule) => rule.enabled)
    .slice(0, 20)
    .map((rule) => {
      const parts = [
        `${rule.merchant_pattern} → ${rule.normalized_merchant_name ?? "(merchant)"}`,
        rule.intent ?? "(intent)"
      ];
      if (rule.is_recurring !== null) parts.push(rule.is_recurring ? "recurring" : "one-time");
      return `- ${parts.join(", ")}`;
    });

  const examples = (request.userCorrections ?? [])
    .slice(0, 15)
    .map((c) => {
      const recurring = c.recurring === true ? ", recurring" : c.recurring === false ? ", one-time" : "";
      return `- "${c.merchant}" → ${c.categoryName}, ${c.intent}${recurring}`;
    });

  const sections = [
    "You are Tally's transaction analyst. You clean up and categorize a single personal bank transaction.",
    "Return ONE JSON object matching the schema. Reason carefully, but output only the JSON.",
    "",
    "Rules:",
    "- categoryName: choose from the user's category list VERBATIM (exact spelling). Match the merchant's real-world business, not just the Plaid hint.",
    "- Never return 'Uncategorized'. If nothing clearly fits, pick the closest concrete category and set confidence below 0.7.",
    "- merchantName: human-friendly normalization of the raw descriptor (e.g. 'AMZN MKTP US*ABC' → 'Amazon', 'SQ *BLUE BOTTLE' → 'Blue Bottle Coffee', 'TST* THE GROVE' → 'The Grove').",
    "- recurring: true ONLY for clearly repeating subscriptions/bills (Netflix, rent, insurance, utilities, gym). One-off purchases are false.",
    "",
    "intent — pick the most specific that the evidence supports (default personal):",
    "- personal: an ordinary expense for yourself.",
    "- business: a work/business expense (your own business or job).",
    "- reimbursable: you fronted money you expect to be paid back for (work travel, covered a friend's share and they'll repay you).",
    "- shared: a cost split with someone (roommate, partner, group) where you each owe a portion.",
    "- transfer: money moving between your OWN accounts, a credit-card payment, an ATM withdrawal, or cashing out Venmo/Zelle to yourself — NOT a real expense or income.",
    "Note: a negative amount is an expense/outflow; a positive amount is income/refund/inflow. Don't tag everyday solo purchases as shared/reimbursable without a real signal.",
    "",
    "- confidence ∈ [0,1]. ≥0.85 = sure. 0.7–0.85 = likely. <0.7 = user should review. Be honest; a calibrated low score is more useful than false certainty.",
    "- reason: ONE short sentence (< 80 chars) citing the concrete evidence you used.",
    "",
    `Available categories: ${categoryList.join(", ") || "Shopping"}`
  ];

  if (merchantRules.length > 0) {
    sections.push("", "Saved merchant rules (user's saved automations):", ...merchantRules);
  }

  if (examples.length > 0) {
    sections.push("", "User's recent label corrections (treat as ground truth for similar merchants):", ...examples);
  }

  return sections.join("\n");
}

function buildUserPrompt(request: TransactionSuggestionRequest, baseline: TransactionAiSuggestion) {
  const raw = request.rawTransaction;
  return [
    "Categorize this transaction:",
    `- name: ${raw.name}`,
    `- merchant: ${raw.merchant_name ?? "(none)"}`,
    `- amount: ${raw.amount} ${raw.iso_currency_code}`,
    `- channel: ${raw.payment_channel ?? "(unknown)"}`,
    `- plaid_category: ${raw.plaid_category ?? "(none)"}`,
    "",
    `Heuristic suggestion (use only if you have no better signal): ${baseline.category.value.name}, ${baseline.intent.value}, confidence ${baseline.confidence.toFixed(2)}.`
  ].join("\n");
}

function buildReimbursementCandidateSystemPrompt() {
  return [
    "You are Tally's reimbursement judge. Tally's matcher has already paired ONE expense with the",
    "nearby peer-payment inflow(s) most likely to repay it. Your job is to judge how plausible that",
    "match really is, and only flag it when it's worth asking the user. Return ONE JSON object.",
    "",
    "Be skeptical — precision matters far more than recall. A real reimbursement usually means:",
    "- Timing: the inflow lands ON or a FEW DAYS AFTER the expense (someone paying you back). Large gaps,",
    "  or an inflow well before the expense, are weak.",
    "- Amount: the inflow (or the inflows summed) plausibly equals the whole bill OR a clean split of it",
    "  (about ½, ⅓, ¼). An inflow that's a tiny fraction, or larger than the expense, is weak.",
    "- Counterparty: an identifiable person (e.g. 'Venmo Maya R', 'Zelle from Jordan'). Generic or",
    "  merchant-looking sources are weak.",
    "",
    "Calibrate confidence honestly: ≥0.75 only for a clean, close, amount-consistent match from a named",
    "person; 0.5–0.75 plausible but worth confirming; <0.5 when the match is weak — Tally will then NOT",
    "nag the user. Do not invent matches.",
    "",
    "suggestedIntent: 'reimbursable' = someone is paying you back for money you fronted; 'shared' = the",
    "cost was split and the inflow is their share.",
    "Use ONLY the provided app-owned inflow ids in suggestedInflowIds — drop any that don't fit.",
    "question: ONE natural sentence naming the person and amount when known",
    "(e.g. \"Did Maya pay you back $44 for Milestone Tavern on Jun 1?\"). Never claim it's already reimbursed.",
    "reason: ONE short sentence citing the timing/amount/counterparty evidence."
  ].join("\n");
}

function reimbursementDayGap(expenseDate: string, inflowDate: string) {
  const expenseMs = Date.parse(`${expenseDate}T12:00:00.000Z`);
  const inflowMs = Date.parse(`${inflowDate}T12:00:00.000Z`);
  if (!Number.isFinite(expenseMs) || !Number.isFinite(inflowMs)) return null;
  return Math.round((inflowMs - expenseMs) / 86_400_000);
}

function describeReimbursementInflow(
  inflow: ReimbursementCandidateAiRequest["candidateInflows"][number],
  expense: ReimbursementCandidateAiRequest["transaction"]
) {
  const expenseAmount = Math.abs(expense.amount);
  const gap = reimbursementDayGap(expense.date, inflow.date);
  const gapText = gap === null
    ? "unknown timing"
    : gap === 0
      ? "same day"
      : gap > 0
        ? `${gap}d after expense`
        : `${Math.abs(gap)}d BEFORE expense`;
  const ratioText = expenseAmount > 0
    ? `${Math.round((inflow.amount / expenseAmount) * 100)}% of the bill`
    : "n/a";
  return `- ${inflow.id}: ${inflow.date} (${gapText}), ${inflow.merchant}, +${inflow.amount.toFixed(2)} (${ratioText}), ${inflow.category}`;
}

function buildReimbursementCandidateUserPrompt(
  request: ReimbursementCandidateAiRequest,
  baseline: ReimbursementCandidateAiSuggestion
) {
  const inflows = request.candidateInflows.map((inflow) =>
    describeReimbursementInflow(inflow, request.transaction)
  );
  const inflowSum = request.candidateInflows.reduce((total, inflow) => total + inflow.amount, 0);
  const expenseAmount = Math.abs(request.transaction.amount);
  const patterns = (request.historicalPatterns ?? []).slice(0, 8).map((pattern) =>
    `- ${pattern.merchant ?? "(merchant)"} / ${pattern.category ?? "(category)"} → ${pattern.suggestedIntent ?? "shared"}${pattern.counterparty ? ` with ${pattern.counterparty}` : ""}`
  );

  return [
    "Expense to judge:",
    `- id: ${request.transaction.id}`,
    `- date: ${request.transaction.date}`,
    `- merchant: ${request.transaction.merchant}`,
    `- amount: ${request.transaction.amount.toFixed(2)} (you paid ${expenseAmount.toFixed(2)})`,
    `- category: ${request.transaction.category}`,
    `- current_intent: ${request.transaction.intent}`,
    "",
    `Matched inflow(s) — combined ${inflowSum.toFixed(2)} (${expenseAmount > 0 ? `${Math.round((inflowSum / expenseAmount) * 100)}% of the bill` : "n/a"}):`,
    ...(inflows.length > 0 ? inflows : ["- none (the matcher found no peer inflow — return confidence below 0.4)"]),
    "",
    "Matcher notes:",
    ...request.heuristicReasons.slice(0, 6).map((reason) => `- ${reason}`),
    "",
    patterns.length > 0 ? "User's past reimbursement patterns:" : "User's past reimbursement patterns: none",
    ...patterns,
    "",
    "Judge the match per the rules. If timing, amount, and counterparty all line up, score high and write a",
    "specific question; if any is weak, lower the confidence accordingly.",
    `(Heuristic baseline for reference only: ${baseline.suggestedIntent}, confidence ${baseline.confidence.toFixed(2)}.)`
  ].join("\n");
}

function extractOutputText(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;

  const texts = output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  });

  return texts.join("").trim() || null;
}

function coerceString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coerceCategory(
  value: unknown,
  request: TransactionSuggestionRequest,
  fallback: CategorySuggestion
): { category: CategorySuggestion; usedFallback: boolean } {
  const categoryName = coerceString(value);
  if (!categoryName || isUncategorizedCategoryName(categoryName)) {
    return {
      category: concreteFallbackCategory(request, fallback),
      usedFallback: true
    };
  }

  const category = request.categories?.find((candidate) =>
    candidate.name.toLowerCase() === categoryName.toLowerCase()
  );

  if (!category) {
    return {
      category: concreteFallbackCategory(request, fallback),
      usedFallback: true
    };
  }

  return {
    category: {
      id: category.id,
      name: category.name
    },
    usedFallback: false
  };
}

function isUncategorizedCategoryName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() === "uncategorized";
}

function concreteFallbackCategory(
  request: TransactionSuggestionRequest,
  fallback: CategorySuggestion
): CategorySuggestion {
  if (!isUncategorizedCategoryName(fallback.name)) return fallback;

  const categories = (request.categories ?? []).filter((category) =>
    !isUncategorizedCategoryName(category.name) &&
    category.name.trim().toLowerCase() !== "transfer"
  );
  const preferredCategory = PREFERRED_CONCRETE_FALLBACK_CATEGORIES
    .map((name) => categories.find((category) => category.name.toLowerCase() === name.toLowerCase()))
    .find((category): category is NonNullable<typeof category> => Boolean(category));
  const category = preferredCategory ?? categories[0];

  return category
    ? { id: category.id, name: category.name }
    : fallback;
}

function coerceIntent(value: unknown, fallback: SupportedIntent): SupportedIntent {
  return typeof value === "string" && SUPPORTED_INTENTS.has(value as SupportedIntent)
    ? value as SupportedIntent
    : fallback;
}

function coerceConfidence(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(0.98, Math.max(0, value))
    : Math.min(0.9, fallback);
}

function coerceSignals(value: unknown, fallback: readonly string[]) {
  if (!Array.isArray(value)) return [...fallback];

  const signals = value
    .filter((signal): signal is string => typeof signal === "string" && signal.trim().length > 0)
    .map((signal) => signal.trim())
    .slice(0, 5);

  return signals.length > 0 ? signals : [...fallback];
}

function coerceKnownIds(value: unknown, allowedIds: readonly string[], fallbackIds: readonly string[]) {
  const allowed = new Set(allowedIds);
  if (!Array.isArray(value)) {
    return fallbackIds.filter((candidate) => allowed.has(candidate)).slice(0, 5);
  }
  return value
    .filter((candidate): candidate is string => typeof candidate === "string" && allowed.has(candidate))
    .slice(0, 5);
}

function sanitizeOpenAiError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240);
  if (typeof error === "string") return error.slice(0, 240);
  return "Unknown OpenAI suggestion error";
}

export function createConfiguredSuggestionAdapter(): AiSuggestionAdapter {
  assertServerRuntime();
  return isOpenAiSuggestionConfigured()
    ? createOpenAiSuggestionAdapter()
    : createMockSuggestionAdapter();
}

export function suggestTransactionWithConfiguredProvider(request: TransactionSuggestionRequest) {
  assertServerRuntime();
  return isOpenAiSuggestionConfigured()
    ? createOpenAiSuggestionAdapter().suggestTransaction(request)
    : Promise.resolve(suggestTransactionWithMockProvider(request));
}
