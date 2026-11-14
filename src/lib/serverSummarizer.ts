import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ImageData {
  mimeType: string;
  data: string; // base64 string
}

export interface SummaryResult {
  keyConcepts: string[];
  importantPoints: string[];
  keywords: string[];
  unreadableMessage?: string;
  rawMarkdown: string;
  // Backward compatibility fields for any existing consumers
  overview?: string;
  takeaways?: string[];
  formulas?: Array<{ name: string; body: string }>;
  examPoints?: string[];
}

/**
 * Ordered fallback chain for Gemini models.
 * Prioritizes fast, natively multimodal Flash models.
 */
export const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
] as const;

export function getModelList(): string[] {
  const envModels = process.env["GEMINI_MODELS"];
  if (envModels && typeof envModels === "string" && envModels.trim()) {
    const parsed = envModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [...DEFAULT_MODELS];
}

export const FALLBACK_MODELS = DEFAULT_MODELS;

export const HARDCODED_FALLBACK: SummaryResult = {
  keyConcepts: [],
  importantPoints: [],
  keywords: [],
  unreadableMessage: "I could not find clear readable notes in this image.",
  rawMarkdown: "I could not find clear readable notes in this image.",
  overview: "I could not find clear readable notes in this image.",
  takeaways: [],
  formulas: [],
  examPoints: [],
};

export function extractSuggestedModel(errorMessage: string | undefined): string | null {
  if (!errorMessage || typeof errorMessage !== "string") return null;
  const match = errorMessage.match(/(?:use|suggested|try|recommend(?:ed)?)\s+[`"']?(gemini-[a-zA-Z0-9.-]+)[`"']?/i);
  return match ? match[1]! : null;
}

export interface SummarizerInput {
  notes?: string | undefined;
  images?: ImageData[] | undefined;
  image?: (ImageData | string) | undefined;
  language?: string | undefined;
  lang?: string | undefined;
}

/**
 * Retrieves the Gemini API key strictly from the server environment.
 * In local development, also inspects root .env if not loaded into process.env.
 */
export function getServerApiKey(): string {
  const envKey = process.env["GEMINI_API_KEY"];
  if (envKey && typeof envKey === "string" && envKey.trim()) {
    return envKey.trim();
  }

  try {
    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      const match = content.match(/^\s*GEMINI_API_KEY\s*=\s*([^\r\n#]+)/m);
      const val = match?.[1]?.trim();
      if (val) {
        const key = val.replace(/^['"]|['"]$/g, "");
        process.env["GEMINI_API_KEY"] = key;
        return key;
      }
    }
  } catch {}

  throw new Error(
    "Server configuration error: GEMINI_API_KEY is not set in environment variables."
  );
}

export const EXACT_SYSTEM_PROMPT = `You are a strict note-organizing assistant. You will be given an image of handwritten or printed study notes. Your ONLY job is to extract and organize the actual content visible in the image — do not add any information, facts, explanations, or examples that are not explicitly written in the image. If part of the image is unclear or illegible, skip it rather than guessing. Do not use your own general knowledge about the topic to fill gaps. Format your response in this structure exactly:

## Key Concepts / Topics
(list the main topics/headings exactly as found in the notes)

## Important Points
(organize the actual written content into clear bullet points, staying as close to the original wording as possible)

## Keywords / Terms
(list key terms or words that appear in the notes)

If the image does not contain readable study notes, respond only with: 'I could not find clear readable notes in this image.'`;

/**
 * Parses structured markdown returned by Gemini into a clean SummaryResult.
 * Strictly adheres to the 3 sections: Key Concepts / Topics, Important Points, Keywords / Terms.
 */
export function parseSummaryResponse(rawText: string): SummaryResult {
  const text = (rawText || "").replace(/\r\n/g, "\n").trim();

  // 1. Check for unreadable notes condition
  if (
    /could not find clear readable notes in this image/i.test(text) ||
    !text
  ) {
    const msg = "I could not find clear readable notes in this image.";
    return {
      keyConcepts: [],
      importantPoints: [],
      keywords: [],
      unreadableMessage: msg,
      rawMarkdown: text || msg,
      overview: msg,
      takeaways: [],
      formulas: [],
      examPoints: [],
    };
  }

  // 2. Parse structured Markdown sections using reliable index offsets
  const headers = [
    { key: "keyConcepts", regex: /(?:^|\n)##\s*Key Concepts\s*(?:\/|&|and)?\s*Topics\s*:?/i },
    { key: "importantPoints", regex: /(?:^|\n)##\s*Important Points\s*:?/i },
    { key: "keywords", regex: /(?:^|\n)##\s*Keywords\s*(?:\/|&|and)?\s*Terms\s*:?/i },
  ];

  const matches: { key: string; index: number; matchLength: number }[] = [];
  for (const h of headers) {
    const m = text.match(h.regex);
    if (m && m.index !== undefined) {
      matches.push({ key: h.key, index: m.index, matchLength: m[0].length });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const rawSections: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current) continue;
    const next = matches[i + 1];
    const startIndex = current.index + current.matchLength;
    const endIndex = next ? next.index : text.length;
    rawSections[current.key] = text.slice(startIndex, endIndex).trim();
  }

  function extractItems(block?: string): string[] {
    if (!block) return [];
    return block
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-*•►▶→]|\d+[\.\)])\s*/, "").trim())
      .filter((line) => line.length > 0 && !line.startsWith("(") && !line.startsWith("#"));
  }

  function extractKeywords(block?: string): string[] {
    if (!block) return [];
    const lines = extractItems(block);
    const keywords: string[] = [];
    for (const line of lines) {
      const parts = line
        .split(/[,;]+/)
        .map((k) => k.replace(/[*_`]/g, "").trim())
        .filter(Boolean);
      keywords.push(...parts);
    }
    return keywords;
  }

  const keyConcepts = extractItems(rawSections["keyConcepts"]);
  const importantPoints = extractItems(rawSections["importantPoints"]);
  const keywords = extractKeywords(rawSections["keywords"]);

  // Fallback if model omitted ## headers
  if (keyConcepts.length === 0 && importantPoints.length === 0 && keywords.length === 0) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      keyConcepts: paragraphs.slice(0, 1),
      importantPoints: paragraphs.slice(1, 6),
      keywords: [],
      rawMarkdown: text,
      overview: paragraphs[0] || "",
      takeaways: paragraphs.slice(1, 6),
      formulas: [],
      examPoints: paragraphs.slice(1, 6),
    };
  }

  return {
    keyConcepts,
    importantPoints,
    keywords,
    rawMarkdown: text,
    overview: keyConcepts.join(" · ") || importantPoints[0] || "",
    takeaways: importantPoints,
    formulas: [],
    examPoints: importantPoints,
  };
}

/**
 * Calls a single Gemini model with timeout protection and multimodal payload.
 */
interface SingleAttemptResult {
  ok: boolean;
  status: number;
  text?: string;
  errorType: string;
  error: string;
  suggestedModel?: string | null;
}

async function callGeminiSingleAttempt(
  content: { text?: string | undefined; images?: ImageData[] | undefined; language?: string | undefined },
  apiKey: string,
  modelName: string,
  timeoutMs = 20000
): Promise<SingleAttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const parts: any[] = [];

    const languageInstruction = content.language
      ? `\n\nCRITICAL LANGUAGE REQUIREMENT: All headings, explanations, bullet points, and extracted terms must be written strictly in ${content.language}.`
      : "";

    const effectiveSystemPrompt = `${EXACT_SYSTEM_PROMPT}${languageInstruction}`;

    if (content.text && content.text.trim()) {
      parts.push({
        text: `${effectiveSystemPrompt}\n\n---\nDOCUMENT / STUDY NOTES CONTENT:\n${content.text.trim()}`,
      });
    } else {
      parts.push({
        text: effectiveSystemPrompt,
      });
    }

    if (content.images && content.images.length > 0) {
      for (const img of content.images) {
        if (img.data) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType || "image/jpeg",
              data: img.data.replace(/^data:[^;]+;base64,/, ""),
            },
          });
        }
      }
    }

    const payload = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        temperature: 0.1, // Strict factual extraction, zero hallucination
        topP: 0.95,
        maxOutputTokens: 2500,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const apiError = errorJson?.error?.message || response.statusText;
      const suggestedModel = response.status === 404 ? extractSuggestedModel(apiError) : null;
      return {
        ok: false,
        status: response.status,
        errorType: `HTTP ${response.status}`,
        error: `[${modelName}] HTTP ${response.status}: ${apiError}`,
        suggestedModel,
      };
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text || !text.trim()) {
      return {
        ok: false,
        status: 200,
        errorType: "Empty Content",
        error: `[${modelName}] Empty content received from Gemini model`,
        suggestedModel: null,
      };
    }

    return {
      ok: true,
      status: 200,
      text: text.trim(),
      errorType: "",
      error: "",
    };
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError";
    return {
      ok: false,
      status: isTimeout ? 408 : 0,
      errorType: isTimeout ? "Timeout (20s)" : "Network Error",
      error: isTimeout ? `[${modelName}] Request timed out after ${timeoutMs / 1000}s` : `[${modelName}] ${err?.message || String(err)}`,
      suggestedModel: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executes the fallback chain across the ordered model list.
 * Per model: 20s timeout, retry once on 429/503, inspect 404 suggested model.
 */
async function callGeminiWithFallbackChain(
  content: { text?: string | undefined; images?: ImageData[] | undefined; language?: string | undefined },
  apiKey: string
): Promise<{ text: string | null; allFailed: boolean }> {
  const models = getModelList();
  const modelErrors: string[] = [];
  const triedModels = new Set<string>();

  for (const model of models) {
    if (triedModels.has(model)) continue;
    triedModels.add(model);

    // Attempt 1: 20s timeout
    const t0 = Date.now();
    console.log(`[CampusSync Server] [Model: ${model}] [Attempt 1] Starting request (timeout: 20s)...`);
    const res1 = await callGeminiSingleAttempt(content, apiKey, model, 20000);
    const duration1 = Date.now() - t0;

    if (res1.ok && res1.text) {
      console.log(`[CampusSync Server] [Model: ${model}] [Attempt 1] SUCCESS in ${duration1}ms`);
      return { text: res1.text, allFailed: false };
    }

    console.warn(`[CampusSync Server] [Model: ${model}] [Attempt 1] FAILED in ${duration1}ms | ErrorType: ${res1.errorType} | Details: ${res1.error}`);
    modelErrors.push(`${model} (Attempt 1): ${res1.error}`);

    // If 404 returned a suggested replacement model, try it immediately
    if (res1.status === 404 && res1.suggestedModel && !triedModels.has(res1.suggestedModel)) {
      const suggested = res1.suggestedModel;
      triedModels.add(suggested);
      console.log(`[CampusSync Server] [Model: ${model}] 404 suggested replacement model: "${suggested}". Attempting suggested model now...`);
      const tSug = Date.now();
      const resSug = await callGeminiSingleAttempt(content, apiKey, suggested, 20000);
      const durationSug = Date.now() - tSug;

      if (resSug.ok && resSug.text) {
        console.log(`[CampusSync Server] [Model: ${suggested}] [Suggested Attempt] SUCCESS in ${durationSug}ms`);
        return { text: resSug.text, allFailed: false };
      }

      console.warn(`[CampusSync Server] [Model: ${suggested}] [Suggested Attempt] FAILED in ${durationSug}ms | ErrorType: ${resSug.errorType} | Details: ${resSug.error}`);
      modelErrors.push(`${suggested} (Suggested): ${resSug.error}`);
    }

    // Retry once on 429 (Rate Limit) or 503 (Service Unavailable)
    if (res1.status === 429 || res1.status === 503) {
      console.log(`[CampusSync Server] [Model: ${model}] Encountered HTTP ${res1.status}. Waiting 2s before retry (Attempt 2)...`);
      await new Promise((r) => setTimeout(r, 2000));
      const tRetry = Date.now();
      console.log(`[CampusSync Server] [Model: ${model}] [Attempt 2 / Retry] Starting retry (timeout: 20s)...`);
      const resRetry = await callGeminiSingleAttempt(content, apiKey, model, 20000);
      const durationRetry = Date.now() - tRetry;

      if (resRetry.ok && resRetry.text) {
        console.log(`[CampusSync Server] [Model: ${model}] [Attempt 2 / Retry] SUCCESS in ${durationRetry}ms`);
        return { text: resRetry.text, allFailed: false };
      }

      console.warn(`[CampusSync Server] [Model: ${model}] [Attempt 2 / Retry] FAILED in ${durationRetry}ms | ErrorType: ${resRetry.errorType} | Details: ${resRetry.error}`);
      modelErrors.push(`${model} (Attempt 2): ${resRetry.error}`);
    }

    console.log(`[CampusSync Server] [Model: ${model}] Moving to next model in fallback chain...`);
  }

  console.error(
    `[CampusSync Server] All Gemini models in fallback chain failed.\nErrors:\n${modelErrors.join("\n")}\nReturning hardcoded fallback response so the app never breaks.`
  );
  return { text: null, allFailed: true };
}

/**
 * Server-side entry point for summarization.
 * Supports both text notes and native images (multimodal vision).
 * Never breaks: returns safe hardcoded fallback on upstream failure.
 */
export async function runServerGeminiSummarizer(
  input: string | SummarizerInput
): Promise<SummaryResult> {
  let notes = "";
  const images: ImageData[] = [];
  let language: string | undefined = undefined;

  if (typeof input === "string") {
    notes = input.trim();
  } else if (input && typeof input === "object") {
    notes = (input.notes || "").trim();
    language = input.language || input.lang;
    if (Array.isArray(input.images)) {
      images.push(...input.images);
    }
    if (input.image) {
      if (typeof input.image === "string") {
        const match = input.image.match(/^data:([^;]+);base64,(.+)$/);
        const mimeType = match?.[1] ?? "image/jpeg";
        const data = match?.[2] ?? input.image;
        images.push({ mimeType, data });
      } else if (typeof input.image === "object" && input.image.data) {
        images.push(input.image);
      }
    }
  }

  if (!notes && images.length === 0) {
    throw new Error("No readable text notes or image provided. Please upload notes or paste text.");
  }

  let apiKey: string;
  try {
    apiKey = getServerApiKey();
  } catch (err: any) {
    console.error("[CampusSync Server] GEMINI_API_KEY missing:", err?.message);
    return { ...HARDCODED_FALLBACK };
  }

  const { text: rawResponse, allFailed } = await callGeminiWithFallbackChain(
    { text: notes, images, language },
    apiKey
  );

  if (allFailed || !rawResponse) {
    return { ...HARDCODED_FALLBACK };
  }

  return parseSummaryResponse(rawResponse);
}
