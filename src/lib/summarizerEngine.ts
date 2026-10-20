import { createServerFn } from "@tanstack/react-start";
import {
  runServerGeminiSummarizer,
  type SummaryResult,
  type ImageData,
} from "./serverSummarizer";
import { apiUrl, getApiBaseUrl } from "./api";

export type { SummaryResult, ImageData, SummarizerInput } from "./serverSummarizer";
export { FALLBACK_MODELS, EXACT_SYSTEM_PROMPT } from "./serverSummarizer";

/**
 * Server function using TanStack Start's createServerFn.
 * Strictly executes on the server and reads process.env.GEMINI_API_KEY.
 */
export const summarizeNotesServerFn = createServerFn({ method: "POST" })
  .validator((data: { notes?: string | undefined; images?: ImageData[] | undefined }) => data)
  .handler(async ({ data }) => {
    return await runServerGeminiSummarizer({
      notes: data.notes,
      images: data.images,
    });
  });

/**
 * Client-facing summarization function.
 * Sends raw extracted notes and/or base64 image data to the configured backend API
 * using import.meta.env.VITE_API_BASE_URL.
 */
export async function generateSummaryFromText(
  notes: string,
  images?: ImageData[],
  onStatusUpdate?: (status: string) => void
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
  };

  // If a separate backend URL is specified (e.g. Render backend), target it directly
  if (hasExternalBackend) {
    onStatusUpdate?.("Processing notes via Render backend…");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

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
