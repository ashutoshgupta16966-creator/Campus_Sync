import { createServerFn } from "@tanstack/react-start";
import {
  runServerGeminiSummarizer,
  type SummaryResult,
  type ImageData,
} from "./serverSummarizer";
import { apiUrl, getApiBaseUrl } from "./api";

export type { SummaryResult, ImageData, SummarizerInput } from "./serverSummarizer";
export { FALLBACK_MODELS, EXACT_SYSTEM_PROMPT } from "./serverSummarizer";

// Frontend timeout set to 190s (longer than backend worst-case chain of 5 tiers x 35s = 175s)
const FRONTEND_REQUEST_TIMEOUT_MS = 190000;

/**
 * Executes a fetch request with timeout protection (120s) and automatic
 * retry for Render free-tier cold starts (network errors, 502/503 responses).
 * Keeps the loading state active and informs the user via onStatusUpdate.
 */
async function fetchWithColdStartRetry(
  url: string,
  options: RequestInit,
  onStatusUpdate?: (status: string) => void,
  timeoutMs = FRONTEND_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const executeSingleRequest = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const response = await executeSingleRequest();

    // 502 (Bad Gateway) or 503 (Service Unavailable) occurs when Render is waking up
    if (response.status === 502 || response.status === 503) {
      console.warn(
        `[CampusSync Frontend] Server returned HTTP ${response.status} (likely Render cold start). Retrying in 5 seconds...`
      );
      onStatusUpdate?.("Backend server is waking up (Render free tier cold start)… Retrying in 5 seconds…");
      await new Promise((r) => setTimeout(r, 5000));
      onStatusUpdate?.("Re-connecting to backend server…");
      return await executeSingleRequest();
    }

    return response;
  } catch (err: any) {
    const isAbort = err?.name === "AbortError";
    console.warn(
      `[CampusSync Frontend] Initial fetch failed (${isAbort ? "timeout" : err?.message || String(err)}). Retrying in 5 seconds for Render wake-up...`
    );
    onStatusUpdate?.("Backend server is waking up (Render free tier cold start)… Retrying in 5 seconds…");
    await new Promise((r) => setTimeout(r, 5000));
    onStatusUpdate?.("Re-connecting to backend server…");
    return await executeSingleRequest();
  }
}

/**
 * Server function using TanStack Start's createServerFn.
 * Strictly executes on the server and reads process.env.GEMINI_API_KEY.
 */
export const summarizeNotesServerFn = createServerFn({ method: "POST" })
  .validator((data: { notes?: string | undefined; images?: ImageData[] | undefined; language?: string | undefined }) => data)
  .handler(async ({ data }) => {
    return await runServerGeminiSummarizer({
      notes: data.notes,
      images: data.images,
      language: data.language,
    });
  });

/**
 * Client-facing summarization function.
 * Sends raw extracted notes and/or base64 image data to the configured backend API
 * using import.meta.env.VITE_API_BASE_URL.
 * Supports 120s timeout and automatic Render cold-start retry.
 */
export async function generateSummaryFromText(
  notes: string,
  images?: ImageData[],
  onStatusUpdate?: (status: string) => void,
  language?: string
): Promise<SummaryResult> {
  const cleanNotes = (notes || "").trim();
  const validImages = Array.isArray(images) ? images.filter((img) => img && img.data) : [];

  if (!cleanNotes && validImages.length === 0) {
    throw new Error("No readable text or image provided. Please upload notes or paste text.");
  }

  const endpoint = apiUrl("/api/summarize");
  const hasExternalBackend = Boolean(getApiBaseUrl());

  const payload = {
    notes: cleanNotes,
    images: validImages,
    language: language || undefined,
  };

  // If a separate backend URL is specified (e.g. Render backend), target it directly
  if (hasExternalBackend) {
    onStatusUpdate?.("Connecting to Render backend server…");
    const response = await fetchWithColdStartRetry(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      onStatusUpdate,
      FRONTEND_REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const apiError = errorJson?.error || response.statusText;
      throw new Error(`Backend error (${response.status}): ${apiError}`);
    }

    return (await response.json()) as SummaryResult;
  }

  // Local / same-origin environment: try API endpoint first, fallback to ServerFn
  onStatusUpdate?.("Analyzing notes with Gemini AI…");
  try {
    const response = await fetchWithColdStartRetry(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      onStatusUpdate,
      FRONTEND_REQUEST_TIMEOUT_MS
    );

    if (response.ok) {
      return (await response.json()) as SummaryResult;
    }
  } catch (fetchErr) {
    console.warn("[CampusSync] Direct API fetch failed, falling back to ServerFn:", fetchErr);
  }

  // Fallback to internal TanStack Start RPC
  try {
    return await summarizeNotesServerFn({ data: payload });
  } catch (rpcErr: any) {
    throw new Error(rpcErr?.message || "Failed to generate summary from backend.");
  }
}
