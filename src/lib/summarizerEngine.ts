export interface FormulaItem {
  name: string;
  body: string;
}

export interface SummaryResult {
  overview: string;          // 📌 Quick Overview
  takeaways: string[];       // 🔑 Key Concepts & Takeaways
  formulas: FormulaItem[];   // 💡 Important Definitions / Formulas
  examPoints: string[];      // 🧠 Revision Notes
  rawMarkdown?: string;      // Raw Gemini response
}

const STORAGE_KEY = "campus_sync_gemini_api_key";

/**
 * Retrieves the Gemini API Key from environment or localStorage.
 */
export function getGeminiApiKey(): string | null {
  // 1. Vite environment variable
  try {
    const envKey =
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      (import.meta as any).env?.GEMINI_API_KEY;

    if (
      envKey &&
      typeof envKey === "string" &&
      envKey.trim().length > 0 &&
      !envKey.includes("your_google_gemini_api_key")
    ) {
      return envKey.trim();
    }
  } catch {}

  // 2. Browser localStorage
  if (typeof window !== "undefined") {
    try {
      const localKey = window.localStorage.getItem(STORAGE_KEY);
      if (localKey && localKey.trim().length > 0) {
        return localKey.trim();
      }
    } catch {}
  }

  return null;
}

/**
 * Stores the Gemini API Key in browser localStorage.
 */
export function setGeminiApiKey(key: string): void {
  if (typeof window !== "undefined") {
    try {
      if (!key || !key.trim()) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, key.trim());
      }
    } catch {}
  }
}

/**
 * Cleans leading bullet, numbering, or icon prefix from a line.
 */
function cleanPrefix(line: string): string {
  return line.replace(/^\s*(?:[-•*►▶→]|\d+[\.\)])\s*/, "").trim();
}

/**
 * Parses structured markdown or JSON returned by Gemini into a clean SummaryResult.
 */
export function parseSummaryResponse(rawText: string): SummaryResult {
  const text = rawText.replace(/\r\n/g, "\n").trim();

  // 1. Check if Gemini returned JSON
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) || text.match(/^\{[\s\S]*\}$/);
    const candidate = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    if (candidate.startsWith("{")) {
      const parsed = JSON.parse(candidate);
      if (parsed.overview || parsed.takeaways) {
        return {
          overview: parsed.overview || "",
          takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
          formulas: Array.isArray(parsed.formulas)
            ? parsed.formulas.map((f: any) => ({
                name: typeof f === "string" ? f : f.name || "Formula",
                body: typeof f === "string" ? "" : f.body || f.formula || f.definition || "",
              }))
            : [],
          examPoints: Array.isArray(parsed.examPoints || parsed.revisionNotes)
            ? (parsed.examPoints || parsed.revisionNotes)
            : [],
          rawMarkdown: text,
        };
      }
    }
  } catch {}

  // 2. Parse structured Markdown sections
  const sectionHeaders = [
    { key: "overview", regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:📌\s*)?Quick Overview(?:\*\*)?:?/i },
    { key: "takeaways", regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:🔑\s*)?Key Concepts(?:\s*(?:&|and)\s*Takeaways)?(?:\*\*)?:?/i },
    { key: "formulas", regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:💡\s*)?Important Definitions(?:\s*(?:\/|&|and)\s*Formulas)?(?:\*\*)?:?/i },
    { key: "examPoints", regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:🧠\s*)?(?:Revision Notes|Exam(?:\s*(?:\/|&|and)\s*)?Revision Summary)(?:\*\*)?:?/i },
  ];

  const matches: { key: string; index: number; matchLength: number }[] = [];
  for (const sh of sectionHeaders) {
    const m = text.match(sh.regex);
    if (m && m.index !== undefined) {
      matches.push({ key: sh.key, index: m.index, matchLength: m[0].length });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const rawSections: Record<string, string> = {};
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const startIndex = current.index + current.matchLength;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
    rawSections[current.key] = text.slice(startIndex, endIndex).trim();
  }

  // 1. Overview
  const overview = (rawSections["overview"] || "")
    .replace(/^[-•*]\s*/, "")
    .trim();

  // 2. Takeaways (Step-by-step numbered breakdown)
  const takeawaysRaw = rawSections["takeaways"] || "";
  const takeaways = takeawaysRaw
    .split(/\n+/)
    .map((line) => cleanPrefix(line))
    .filter((line) => line.length > 5);

  // 3. Definitions & Formulas
  const formulasRaw = rawSections["formulas"] || "";
  const formulas: FormulaItem[] = [];
  formulasRaw.split(/\n+/).forEach((line) => {
    const clean = cleanPrefix(line);
    if (!clean || clean.length < 3) return;

    const splitIdx = clean.indexOf(":");
    const splitEq = clean.indexOf("=");
    let splitPos = -1;
    if (splitIdx > 0 && splitEq > 0) splitPos = Math.min(splitIdx, splitEq);
    else if (splitIdx > 0) splitPos = splitIdx;
    else if (splitEq > 0) splitPos = splitEq;

    if (splitPos > 0 && splitPos < 45) {
      const name = clean.slice(0, splitPos).replace(/[*_]/g, "").trim();
      const body = clean.slice(splitPos + 1).replace(/^[:=]\s*/, "").replace(/^[*_]+|[*_]+$/g, "").trim();
      formulas.push({ name, body });
    } else {
      formulas.push({ name: "Core Concept", body: clean.replace(/[*_]/g, "") });
    }
  });

  // 4. Revision Notes
  const examPointsRaw = rawSections["examPoints"] || "";
  const examPoints = examPointsRaw
    .split(/\n+/)
    .map((line) => cleanPrefix(line))
    .filter((line) => line.length > 5);

  // Fallback if formatting was non-standard but model produced text
  if (!overview && !takeaways.length && !formulas.length && !examPoints.length) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      overview: paragraphs[0] || text.slice(0, 300),
      takeaways: paragraphs.slice(1, 6),
      formulas: [],
      examPoints: paragraphs.slice(6, 12),
      rawMarkdown: text,
    };
  }

  return {
    overview,
    takeaways,
    formulas,
    examPoints,
    rawMarkdown: text,
  };
}

const SYSTEM_PROMPT = `You are an expert academic tutor and study assistant for university students.
Analyze the provided study notes, lecture text, textbook excerpt, or OCR document and generate an accurate, high-yield study summary.

You MUST format your response strictly in clean Markdown with exactly these four section headers:

📌 Quick Overview
(Provide a concise 2-3 sentence overview explaining what the material is about and its main academic objective.)

🔑 Key Concepts & Takeaways
(Provide a numbered step-by-step breakdown of the most critical concepts, principles, and mechanisms explained clearly.)

💡 Important Definitions / Formulas
(List definitions of key terms and mathematical/scientific formulas. Format each item on its own line as:
Name: Definition or formula body)

🧠 Revision Notes
(Provide concise bullet points for quick, last-minute exam revision and recall.)

Strict Rules:
- Base all information strictly on the provided content. Do not hallucinate or add unrelated topics.
- Do NOT output greeting, introductory filler, or concluding remarks.
- Only output the 4 sections above.`;

/**
 * Calls the Google Gemini REST API.
 */
async function callGemini(
  prompt: string,
  apiKey: string,
  modelName = "gemini-2.5-flash"
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${SYSTEM_PROMPT}\n\n---\nDOCUMENT / STUDY NOTES CONTENT:\n${prompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
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
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const apiError = errorJson?.error?.message || response.statusText;

    // If model is unavailable (e.g. 404), fallback to gemini-1.5-flash or gemini-2.0-flash
    if (response.status === 404 && modelName !== "gemini-1.5-flash") {
      console.warn(`[CampusSync Gemini] Model ${modelName} returned 404. Trying gemini-1.5-flash...`);
      return callGemini(prompt, apiKey, "gemini-1.5-flash");
    }

    throw new Error(`Gemini API error (${response.status}): ${apiError}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || !text.trim()) {
    throw new Error("Gemini returned an empty response. Please verify your document content.");
  }

  return text.trim();
}

/**
 * Splits text into manageable chunks if content exceeds chunk size limit.
 */
function chunkText(text: string, maxChunkSize = 35000): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let currentChunk = "";

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }
    currentChunk += (currentChunk ? "\n\n" : "") + para;
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Generates an AI summary directly via Gemini API.
 * Completely removes any mock data, fallback templates, or dummy regex responses.
 */
export async function generateSummaryFromText(
  notes: string,
  userApiKey?: string,
  onStatusUpdate?: (status: string) => void
): Promise<SummaryResult> {
  const cleanNotes = notes.trim();

  if (!cleanNotes || cleanNotes.length < 10) {
    throw new Error("No readable text provided. Please upload a file or paste your notes.");
  }

  const apiKey = userApiKey?.trim() || getGeminiApiKey();

  if (!apiKey) {
    throw new Error(
      "Gemini API key is required. Please add VITE_GEMINI_API_KEY in your .env file or click 'API Key' to enter it."
    );
  }

  onStatusUpdate?.("Sending extracted content to Gemini AI…");

  const chunks = chunkText(cleanNotes);

  let fullPrompt = cleanNotes;

  // If document is extremely large, summarize individual chunks first before final synthesis
  if (chunks.length > 1) {
    console.log(`[CampusSync AI] Document is large (${cleanNotes.length} chars). Processing ${chunks.length} chunks...`);
    const intermediateSummaries: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      onStatusUpdate?.(`Processing chunk ${i + 1} of ${chunks.length} with Gemini…`);
      const chunkPrompt = `Summarize the essential concepts, definitions, formulas, and revision points from this section (${i + 1} of ${chunks.length}):\n\n${chunks[i]}`;
      const chunkResult = await callGemini(chunkPrompt, apiKey);
      intermediateSummaries.push(`--- SECTION ${i + 1} SUMMARY ---\n${chunkResult}`);
    }

    fullPrompt = `Synthesize these extracted study sections into a single master study guide:\n\n${intermediateSummaries.join("\n\n")}`;
  }

  onStatusUpdate?.("Generating structured study cards with Gemini…");
  const rawResponse = await callGemini(fullPrompt, apiKey);

  console.log("[CampusSync AI] Received raw Gemini response successfully.");
  return parseSummaryResponse(rawResponse);
}
