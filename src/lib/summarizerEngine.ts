import { createServerFn } from "@tanstack/react-start";
import {
  runServerGeminiSummarizer,
  type SummaryResult,
} from "./serverSummarizer";
import { apiUrl, getApiBaseUrl } from "./api";

export type { FormulaItem, SummaryResult } from "./serverSummarizer";
export { FALLBACK_MODELS } from "./serverSummarizer";

/**
 * Server function using TanStack Start's createServerFn.
 * Strictly executes on the server and reads process.env.GEMINI_API_KEY.
 */
export const summarizeNotesServerFn = createServerFn({ method: "POST" })
  .validator((data: { notes: string }) => data)
  .handler(async ({ data }) => {
    return await runServerGeminiSummarizer(data.notes);
  });

/**
 * Client-facing summarization function.
 * Sends raw extracted notes to the configured backend API (Render/Vercel)
 * using import.meta.env.VITE_API_BASE_URL.
 */
export async function generateSummaryFromText(
  notes: string,
  onStatusUpdate?: (status: string) => void
): Promise<SummaryResult> {
  const cleanNotes = notes.trim();

  if (!cleanNotes || cleanNotes.length < 10) {
    throw new Error("No readable text provided. Please upload a file or paste your notes.");
  }

  const endpoint = apiUrl("/api/summarize");
  const hasExternalBackend = Boolean(getApiBaseUrl());

  // If a separate backend URL is specified (e.g. Render backend), target it directly
  if (hasExternalBackend) {
    onStatusUpdate?.("Processing summary via Render backend…");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notes: cleanNotes }),
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
      body: JSON.stringify({ notes: cleanNotes }),
    });

    if (response.ok) {
      return (await response.json()) as SummaryResult;
    }
  } catch (fetchErr) {
    console.warn("[CampusSync] Direct API fetch failed, falling back to ServerFn:", fetchErr);
  }

  // Fallback to internal TanStack Start RPC
  try {
    return await summarizeNotesServerFn({ data: { notes: cleanNotes } });
  } catch (rpcErr: any) {
    throw new Error(rpcErr?.message || "Failed to generate summary from backend.");
  }
}
