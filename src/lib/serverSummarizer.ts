import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ImageData {
  mimeType: string;
  data: string; // base64 string
}

export interface SummaryResult {
  keyConcepts: string[];
  importantPoints: string[];
  keywords: string[];
  unreadableMessage?: string | undefined;
  rawMarkdown: string;
  // Backward compatibility fields for any existing consumers
  overview?: string | undefined;
  takeaways?: string[] | undefined;
  formulas?: Array<{ name: string; body: string }> | undefined;
  examPoints?: string[] | undefined;
}

export interface ModelTier {
  provider: "anthropic" | "gemini";
  model: string;
}

/**
 * Ordered multi-tier model fallback chain.
 * Tier 1: claude-opus-4.8
 * Tier 2: claude-sonnet-4.6
 * Tier 3: gemini-3.8-flash
 * Tier 4: gemini-3.7-flash
 * Tier 5: gemini-3.6-flash
 */
export const FALLBACK_CHAIN: ModelTier[] = [
  { provider: "anthropic", model: "claude-opus-4.8" },
  { provider: "anthropic", model: "claude-sonnet-4.6" },
  { provider: "gemini", model: "gemini-3.8-flash" },
  { provider: "gemini", model: "gemini-3.7-flash" },
  { provider: "gemini", model: "gemini-3.6-flash" },
];

export const DEFAULT_MODELS = [
  "claude-opus-4.8",
  "claude-sonnet-4.6",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
] as const;

export const FALLBACK_MODELS = DEFAULT_MODELS;

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

export const EXACT_SYSTEM_PROMPT = `You are a strict note-organizing assistant. You will be given study notes (handwritten or printed images, or document text).
Your ONLY job is to extract and organize the actual content visible in the notes:
- Summarise only what is actually written in the notes.
- Do not invent facts, formulas, explanations, or topics that are not in the notes.
- If part of the image is unclear, blurry, or unreadable, say so briefly instead of guessing.
- Keep the notes' original language, terminology, and structure (headings, bullet points).
- Format your response in this structure exactly:

## Key Concepts / Topics
(list the main topics/headings exactly as found in the notes)

## Important Points
(organize the actual written content into clear bullet points, staying as close to the original wording as possible)

## Keywords / Terms
(list key terms or words that appear in the notes)

If the image or input does not contain readable study notes, respond only with: 'I could not find clear readable notes in this image.'`;

export function getAnthropicApiKey(): string | null {
  const envKey = process.env["ANTHROPIC_API_KEY"];
  if (envKey && typeof envKey === "string" && envKey.trim()) {
    return envKey.trim();
  }
  return null;
}

export function getGeminiApiKey(): string | null {
  const envKey = process.env["GEMINI_API_KEY"];
  if (envKey && typeof envKey === "string" && envKey.trim()) {
    return envKey.trim();
  }
  return null;
}

export function getServerApiKey(): string {
  const key = getGeminiApiKey();
  if (key) return key;
  throw new Error(
    "Server configuration error: GEMINI_API_KEY is not set in environment variables."
  );
}

export function extractSuggestedModel(errorMessage: string | undefined): string | null {
  if (!errorMessage || typeof errorMessage !== "string") return null;
  const match = errorMessage.match(/(?:use|suggested|try|recommend(?:ed)?)\s+[`"']?([a-zA-Z0-9.-]+)[`"']?/i);
  return match ? match[1] ?? null : null;
}

/**
 * Cleanly joins partial text from a failed tier with continuation text from the next tier.
 * Deduplicates repeated words at the seam and fixes whitespace.
 */
export function joinContinuationText(existingText: string, incomingText: string): string {
  if (!existingText) return (incomingText || '').trim();
  if (!incomingText) return existingText.trim();

  let trimmedIncoming = incomingText.trimStart();
  const trimmedExisting = existingText.trimEnd();

  const incomingHadLeadingNewline = /^[\r\n]/.test(incomingText);
  const existingHadTrailingNewline = /[\r\n]$/.test(existingText);

  // 1. Check if the next model repeated the last word (or last partial word)
  const existingWords = trimmedExisting.split(/\s+/);
  const lastWord = existingWords[existingWords.length - 1];

  if (lastWord && lastWord.length >= 2) {
    const escapedWord = lastWord.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    // Case 1A: Exact whole-word repetition (e.g. "computer" followed by "computer science")
    const wholeWordRegex = new RegExp(`^${escapedWord}\\b`, 'i');
    if (wholeWordRegex.test(trimmedIncoming)) {
      trimmedIncoming = trimmedIncoming.replace(wholeWordRegex, '').trimStart();
      return `${trimmedExisting} ${trimmedIncoming}`;
    }

    // Case 1B: Prefix repetition (e.g. "compu" followed by "computer science")
    const prefixRegex = new RegExp(`^${escapedWord}`, 'i');
    if (prefixRegex.test(trimmedIncoming)) {
      const suffixAndRest = trimmedIncoming.slice(lastWord.length);
      return `${trimmedExisting}${suffixAndRest}`;
    }
  }

  // 2. Check if boundary contains newlines or starts with a markdown header/bullet
  const incomingIsMarkdownHeaderOrBullet = /^#{1,6}\s|^[-*•►▶→\d]/.test(trimmedIncoming);
  if (incomingHadLeadingNewline || existingHadTrailingNewline || incomingIsMarkdownHeaderOrBullet) {
    return `${trimmedExisting}\n\n${trimmedIncoming}`;
  }

  // 3. If incoming starts with punctuation (e.g. "." or ","), attach without space
  if (/^[.,!?;:)]/.test(trimmedIncoming)) {
    return `${trimmedExisting}${trimmedIncoming}`;
  }

  // 4. Default clean join: always ensure single space between consecutive words
  return `${trimmedExisting} ${trimmedIncoming}`;
}

export function normalizeAndValidateImages(images: ImageData[]): ImageData[] {
  if (!Array.isArray(images) || images.length === 0) return [];
  const valid: ImageData[] = [];
  for (const img of images) {
    if (!img || !img.data) continue;
    let mimeType = (img.mimeType || "image/jpeg").toLowerCase();
    if (mimeType === "image/jpg") mimeType = "image/jpeg";
    const cleanData = img.data.replace(/^data:[^;]+;base64,/, "").trim();
    if (!cleanData) continue;
    valid.push({
      mimeType,
      data: cleanData,
    });
  }
  return valid;
}

export function formatAnthropicContent(
  content: { text?: string | undefined; images?: ImageData[] | undefined },
  partialText: string
): Anthropic.MessageParam["content"] {
  const userBlocks: any[] = [];

  if (Array.isArray(content.images) && content.images.length > 0) {
    for (const img of content.images) {
      if (img.data) {
        userBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: (img.mimeType as any) || "image/jpeg",
            data: img.data,
          },
        });
      }
    }
  }

  let textPrompt = "";
  if (content.text && content.text.trim()) {
    textPrompt += `STUDY NOTES / DOCUMENT CONTENT:\n${content.text.trim()}\n\n`;
  }

  if (partialText && partialText.trim()) {
    textPrompt += `Here is the summary written so far:\n"""\n${partialText.trim()}\n"""\n\nContinue exactly from where it stopped. Do not repeat anything already written. If the text stopped in the middle of a word or sentence, finish that sentence first before continuing. Do not repeat the beginning of the sentence. Do not restart, do not apologise, do not mention any error or model change. Keep the same format and style.`;
  } else {
    textPrompt += `Please extract and organize the study notes according to the system instructions.`;
  }

  userBlocks.push({
    type: "text",
    text: textPrompt,
  });

  return userBlocks;
}

export function formatGeminiContent(
  content: { text?: string | undefined; images?: ImageData[] | undefined },
  partialText: string
): any[] {
  const parts: any[] = [];

  let textPrompt = "";
  if (content.text && content.text.trim()) {
    textPrompt += `STUDY NOTES / DOCUMENT CONTENT:\n${content.text.trim()}\n\n`;
  }

  if (partialText && partialText.trim()) {
    textPrompt += `Here is the summary written so far:\n"""\n${partialText.trim()}\n"""\n\nContinue exactly from where it stopped. Do not repeat anything already written. If the text stopped in the middle of a word or sentence, finish that sentence first before continuing. Do not repeat the beginning of the sentence. Do not restart, do not apologise, do not mention any error or model change. Keep the same format and style.`;
  } else {
    textPrompt += `Please extract and organize the study notes according to the system instructions.`;
  }

  parts.push({ text: textPrompt });

  if (Array.isArray(content.images) && content.images.length > 0) {
    for (const img of content.images) {
      if (img.data) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType || "image/jpeg",
            data: img.data,
          },
        });
      }
    }
  }

  return parts;
}

/**
 * Parses structured markdown returned by models into a clean SummaryResult.
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

export interface StreamAttemptResult {
  success: boolean;
  text: string;
  result: string;
  error?: any;
  suggestedModel?: string | null;
}

/**
 * Streams a single model with a 35s hard timeout and 15s chunk-stall watchdog.
 * Collects text chunks and invokes onChunk callback as chunks arrive.
 */
export async function streamSingleModel({
  provider,
  modelName,
  content,
  partialText,
  effectiveSystemPrompt,
  anthropicApiKey,
  geminiApiKey,
  onChunk,
}: {
  provider: "anthropic" | "gemini";
  modelName: string;
  content: { text?: string | undefined; images?: ImageData[] | undefined };
  partialText: string;
  effectiveSystemPrompt: string;
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
  onChunk: (chunk: string) => void;
}): Promise<StreamAttemptResult> {
  const OVERALL_TIMEOUT_MS = 35000; // 35 seconds
  const STALL_TIMEOUT_MS = 15000; // 15 seconds

  const controller = new AbortController();
  let timedOut = false;
  let stalled = false;

  const overallTimer = setTimeout(() => {
    timedOut = true;
    controller.abort("timeout (35s)");
  }, OVERALL_TIMEOUT_MS);

  let stallTimer: NodeJS.Timeout | null = null;
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort("stalled (no chunk for 15s)");
    }, STALL_TIMEOUT_MS);
  };

  resetStallTimer();

  try {
    let accumulatedText = "";

    if (provider === "anthropic") {
      if (!anthropicApiKey) {
        throw new Error("ANTHROPIC_API_KEY not configured");
      }
      const client = new Anthropic({ apiKey: anthropicApiKey });
      const userContent = formatAnthropicContent(content, partialText);

      const stream = client.messages.stream(
        {
          model: modelName,
          max_tokens: 3500,
          system: effectiveSystemPrompt,
          messages: [
            {
              role: "user",
              content: userContent,
            },
          ],
        },
        { signal: controller.signal }
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          const text = event.delta.text;
          if (text) {
            resetStallTimer();
            accumulatedText += text;
            onChunk(text);
          }
        }
      }
    } else if (provider === "gemini") {
      if (!geminiApiKey) {
        throw new Error("GEMINI_API_KEY not configured");
      }
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: effectiveSystemPrompt,
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          maxOutputTokens: 3500,
        },
      });

      const parts = formatGeminiContent(content, partialText);
      const result = await model.generateContentStream(
        {
          contents: [
            {
              role: "user",
              parts,
            },
          ],
        },
        { signal: controller.signal }
      );

      for await (const chunk of result.stream) {
        let text = "";
        try {
          text = chunk.text();
        } catch {}
        if (text) {
          resetStallTimer();
          accumulatedText += text;
          onChunk(text);
        }
      }
    }

    if (!accumulatedText || !accumulatedText.trim()) {
      return {
        success: false,
        text: "",
        result: "empty answer",
        error: new Error("Empty response received from model stream"),
        suggestedModel: null,
      };
    }

    return {
      success: true,
      text: accumulatedText,
      result: "success",
      suggestedModel: null,
    };
  } catch (err: any) {
    let resultType = "error";
    if (timedOut) {
      resultType = "timeout (35s)";
    } else if (stalled) {
      resultType = "stalled (no chunk for 15s)";
    } else if (err?.name === "AbortError") {
      resultType = "aborted";
    } else if (err?.status) {
      resultType = `HTTP ${err.status}`;
    } else {
      resultType = err?.message || String(err);
    }

    const suggestedModel = extractSuggestedModel(err?.message);

    return {
      success: false,
      text: "",
      result: resultType,
      error: err,
      suggestedModel,
    };
  } finally {
    clearTimeout(overallTimer);
    if (stallTimer) clearTimeout(stallTimer);
  }
}

/**
 * Executes the multi-tier fallback chain with streaming and partial-answer continuation.
 * Follows tiers: Claude Opus 4.8 -> Claude Sonnet 4.6 -> Gemini 3.8 Flash -> 3.7 -> 3.6.
 * Logs backend telemetry only; user never sees model switching.
 */
export async function callMultiModelWithContinuation(content: {
  text?: string | undefined;
  images?: ImageData[] | undefined;
  language?: string | undefined;
}): Promise<{ text: string | null; allFailed: boolean }> {
  const requestStartTime = Date.now();
  const anthropicKey = getAnthropicApiKey();
  const geminiKey = getGeminiApiKey();

  let partialText = "";
  let finalStatus = "all_failed";
  let tiersAttempted = 0;

  const languageInstruction = content.language
    ? `\n\nCRITICAL LANGUAGE REQUIREMENT: All headings, explanations, bullet points, and extracted terms must be written strictly in ${content.language}.`
    : "";
  const effectiveSystemPrompt = `${EXACT_SYSTEM_PROMPT}${languageInstruction}`;

  for (let i = 0; i < FALLBACK_CHAIN.length; i++) {
    const tier = FALLBACK_CHAIN[i];
    if (!tier) continue;
    const tierNumber = i + 1;
    const { provider, model } = tier;

    // Check provider API key availability
    if (provider === "anthropic" && !anthropicKey) {
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Skipped silently (ANTHROPIC_API_KEY not configured).`);
      continue;
    }
    if (provider === "gemini" && !geminiKey) {
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Skipped silently (GEMINI_API_KEY not configured).`);
      continue;
    }

    tiersAttempted++;
    const tierStartTime = Date.now();
    const isContinuation = Boolean(partialText && partialText.trim().length > 0);

    console.log(
      `[CampusSync Backend] [Tier ${tierNumber}: ${model}] START at ${new Date(tierStartTime).toISOString()} | Continuation: ${isContinuation} | Chars collected so far: ${partialText.length}`
    );

    let tierAccumulatedText = "";
    const res = await streamSingleModel({
      provider,
      modelName: model,
      content,
      partialText,
      effectiveSystemPrompt,
      anthropicApiKey: anthropicKey,
      geminiApiKey: geminiKey,
      onChunk: (chunk) => {
        tierAccumulatedText += chunk;
      },
    });

    const tierEndTime = Date.now();
    const elapsedMs = tierEndTime - tierStartTime;

    if (res.success && res.text) {
      partialText = isContinuation
        ? joinContinuationText(partialText, res.text)
        : res.text;

      console.log(
        `[CampusSync Backend] [Tier ${tierNumber}: ${model}] END at ${new Date(tierEndTime).toISOString()} | Elapsed: ${elapsedMs}ms | Result: success | Total chars: ${partialText.length}`
      );
      finalStatus = "success";
      break;
    }

    // Tier failed (timeout, stalled, error, or empty answer)
    console.warn(
      `[CampusSync Backend] [Tier ${tierNumber}: ${model}] END at ${new Date(tierEndTime).toISOString()} | Elapsed: ${elapsedMs}ms | Result: ${res.result} | Chars in tier: ${tierAccumulatedText.length} | Details: ${res.error?.message || res.result}`
    );

    // If text chunks arrived before the failure, preserve them in partialText
    if (tierAccumulatedText.trim().length > 0) {
      partialText = isContinuation
        ? joinContinuationText(partialText, tierAccumulatedText)
        : tierAccumulatedText;
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Preserved ${tierAccumulatedText.length} partial characters for next tier continuation.`);
    }

    // Check if error suggests a replacement model name
    if (res.suggestedModel) {
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Model suggested replacement: ${res.suggestedModel}. Attempting suggested model...`);
      const sugStartTime = Date.now();
      let sugAccumulated = "";
      const sugRes = await streamSingleModel({
        provider,
        modelName: res.suggestedModel,
        content,
        partialText,
        effectiveSystemPrompt,
        anthropicApiKey: anthropicKey,
        geminiApiKey: geminiKey,
        onChunk: (chunk) => {
          sugAccumulated += chunk;
        },
      });
      const sugElapsedMs = Date.now() - sugStartTime;
      if (sugRes.success && sugRes.text) {
        partialText = isContinuation
          ? joinContinuationText(partialText, sugRes.text)
          : sugRes.text;
        console.log(`[CampusSync Backend] [Suggested: ${res.suggestedModel}] SUCCESS in ${sugElapsedMs}ms | Total chars: ${partialText.length}`);
        finalStatus = "success";
        break;
      }
      if (sugAccumulated.trim().length > 0) {
        partialText = joinContinuationText(partialText, sugAccumulated);
      }
    }
  }

  const totalElapsedMs = Date.now() - requestStartTime;
  console.log(
    `[CampusSync Backend] Total request time: ${totalElapsedMs}ms across ${tiersAttempted} tiers attempted. Final status: ${finalStatus} | Total characters: ${partialText.length}`
  );

  return {
    text: partialText || null,
    allFailed: finalStatus !== "success" && !partialText,
  };
}

export interface SummarizerInput {
  notes?: string | undefined;
  images?: ImageData[] | undefined;
  image?: (ImageData | string) | undefined;
  language?: string | undefined;
  lang?: string | undefined;
}

/**
 * Server-side entry point for summarization.
 * Supports both text notes and native images (multimodal vision).
 * Executes multi-tier streaming fallback chain with partial continuation.
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
      images.push(...normalizeAndValidateImages(input.images));
    }
    if (input.image) {
      if (typeof input.image === "string") {
        const match = input.image.match(/^data:([^;]+);base64,(.+)$/);
        images.push({
          mimeType: match ? (match[1] ?? "image/jpeg") : "image/jpeg",
          data: match ? (match[2] ?? input.image) : input.image,
        });
      } else if (typeof input.image === "object" && input.image.data) {
        images.push({
          mimeType: input.image.mimeType || "image/jpeg",
          data: input.image.data.replace(/^data:[^;]+;base64,/, ""),
        });
      }
    }
  }

  if (!notes && images.length === 0) {
    throw new Error("No readable text notes or image provided. Please upload notes or paste text.");
  }

  const { text: finalText, allFailed } = await callMultiModelWithContinuation({
    text: notes,
    images,
    language,
  });

  if (allFailed || !finalText) {
    return { ...HARDCODED_FALLBACK };
  }

  return parseSummaryResponse(finalText);
}
