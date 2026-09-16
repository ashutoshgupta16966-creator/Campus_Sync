import { createServerFn } from "@tanstack/react-start";
import {
  runServerGeminiSummarizer,
  type SummaryResult,
} from "./serverSummarizer";

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
 * Sends raw extracted notes to the server and returns structured study cards.
 * Never requests, accepts, or transmits any client-side API key.
 */
export async function generateSummaryFromText(
  notes: string,
  onStatusUpdate?: (status: string) => void
): Promise<SummaryResult> {
  const cleanNotes = notes.trim();

  if (!cleanNotes || cleanNotes.length < 10) {
    throw new Error("No readable text provided. Please upload a file or paste your notes.");
  }

  onStatusUpdate?.("Analyzing notes with Gemini on server…");

  // Attempt 1: TanStack Start RPC server function
  try {
    const result = await summarizeNotesServerFn({ data: { notes: cleanNotes } });
    return result;
  } catch (rpcErr: any) {
    console.warn(
      "[CampusSync] RPC server function call failed, falling back to /api/summarize endpoint:",
      rpcErr
    );
  }

  // Attempt 2: Direct POST to dedicated server-side /api/summarize endpoint
  onStatusUpdate?.("Processing summary via server API…");
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notes: cleanNotes }),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const apiError = errorJson?.error || response.statusText;
    throw new Error(`Server error (${response.status}): ${apiError}`);
  }

  const result = (await response.json()) as SummaryResult;
  return result;
}
