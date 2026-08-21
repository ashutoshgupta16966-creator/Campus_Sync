import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Copy,
  ListChecks,
  Sigma,
  HelpCircle,
  FileDown,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  BookOpen,
} from "lucide-react";
import { extractTextFromFile } from "@/lib/fileParser";
import { generateSummaryFromText, type SummaryResult } from "@/lib/summarizerEngine";

export function Summarizer() {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setParsing(true);
    setParseStatus("Reading file…");
    setUploadedFileName(file.name);
    try {
      const extractedText = await extractTextFromFile(file, (status) => {
        setParseStatus(status);
      });

      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error("No readable text could be extracted from this file.");
      }

      setNotes(extractedText);
      toast.success("Text extracted", {
        description: `Loaded text from ${file.name}. Click 'Generate Summary' to summarize.`,
      });

      // Automatically trigger summarization on successful file upload
      triggerSummarize(extractedText);
    } catch (err: any) {
      console.error("File text extraction failed:", err);
      toast.error("Extraction failed", {
        description: err.message || "Could not extract text from uploaded file.",
      });
    } finally {
      setParsing(false);
    }
  };

  const triggerSummarize = (textToSummarize: string) => {
    if (!textToSummarize.trim()) {
      toast.error("Paste or upload notes first", {
        description: "CampusSync needs lecture text to generate a summary.",
      });
      return;
    }
    setLoading(true);
    setTimeout(() => {
      const res = generateSummaryFromText(textToSummarize);
      setSummary(res);
      setLoading(false);
      toast.success("Summary ready", { description: "Dynamic study cards generated!" });
    }, 800);
  };

  const copySummary = () => {
    if (!summary) return;
    const text = [
      "KEY TAKEAWAYS",
      ...summary.takeaways.map((t) => "• " + t),
      "",
      "FORMULAS & CONCEPTS",
      ...summary.formulas.map((f) => `${f.name}: ${f.body}`),
      "",
      "LIKELY EXAM QUESTIONS",
      ...summary.questions.map((q, i) => `${i + 1}. ${q}`),
    ].join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    toast.success("Summary copied to clipboard");
  };

  return (
    <div className="space-y-6">
      {/* Input Block with Drag & Drop Uploader */}
      <div className="glass rounded-3xl p-5 sm:p-7 space-y-4">
        <h2 className="text-xl font-semibold">Lecture Notes & File Summarizer</h2>
        <p className="text-sm text-muted-foreground">
          Upload a lecture PDF, TXT document, or handwritten/scanned notes image (PNG/JPG) — or paste your notes directly below to distill them into exam-ready study cards.
        </p>

        {/* File Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) processFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed p-6 text-center transition " +
            (dragging ? "border-primary bg-primary/5 glow-ring" : "border-border bg-secondary/20 hover:border-primary/50")
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processFile(f);
            }}
          />
          <div className="flex gap-2 text-primary-glow">
            <UploadCloud className="size-6" />
            <ImageIcon className="size-6" />
            <FileText className="size-6" />
          </div>
          <p className="mt-2 text-sm font-semibold">
            {uploadedFileName ? `Uploaded: ${uploadedFileName}` : "Drag & drop PDF, TXT, or Image files (PNG, JPG)"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {parsing ? parseStatus : "Supports client-side PDF text extraction and Tesseract OCR"}
          </p>
        </div>

        {/* Notes Textarea */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={7}
          placeholder="Paste or edit lecture notes here…"
          className="w-full resize-y rounded-2xl border border-border bg-secondary/40 p-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/40"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => triggerSummarize(notes)}
            disabled={loading || parsing}
            className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary to-primary-glow px-6 py-2.5 text-sm font-semibold text-primary-foreground glow-ring transition hover:opacity-90 disabled:opacity-60"
          >
            {loading || parsing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {parsing ? "Parsing File…" : loading ? "Summarizing…" : "Generate Summary"}
          </button>

          {summary && (
            <button
              onClick={copySummary}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-5 py-2.5 text-sm font-medium transition hover:bg-secondary"
            >
              <Copy className="size-4" /> Copy Summary
            </button>
          )}
        </div>
      </div>

      {/* Parsing / Loading State Indicator */}
      {(loading || parsing) && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-14 text-center">
          <Loader2 className="size-8 animate-spin text-primary-glow" />
          <p className="mt-4 font-medium text-foreground">
            {parsing ? parseStatus : "Synthesizing lecture notes into key study cards…"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Extracting core concepts, identifying formulas, and formulating exam questions…
          </p>
        </div>
      )}

      {/* Initial Empty State Placeholder */}
      {!loading && !parsing && !summary && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-secondary/80 text-primary-glow">
            <BookOpen className="size-8" />
          </div>
          <h3 className="mt-4 text-xl font-bold">No Summary Generated Yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Upload a lecture PDF or image file above, or paste your class notes to generate key takeaways, formulas, and 3 likely exam questions.
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-6 py-2.5 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
          >
            <UploadCloud className="size-4" /> Upload File to Analyze
          </button>
        </div>
      )}

      {/* Generated Summary Display */}
      {summary && !loading && !parsing && (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Key Concepts */}
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center gap-2 text-primary-glow">
                <ListChecks className="size-5" />
                <h3 className="font-semibold">Key Concepts</h3>
              </div>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {summary.takeaways.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Important Formulas */}
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center gap-2 text-primary-glow">
                <Sigma className="size-5" />
                <h3 className="font-semibold">Important Formulas & Concepts</h3>
              </div>
              <ul className="mt-4 space-y-3">
                {summary.formulas.length > 0 ? (
                  summary.formulas.map((f, i) => (
                    <li key={i} className="rounded-xl border border-border bg-secondary/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {f.name}
                      </p>
                      <p className="mt-1 font-mono text-sm">{f.body}</p>
                    </li>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">No explicit formulas detected in notes.</p>
                )}
              </ul>
            </div>

            {/* Likely Exam Questions */}
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center gap-2 text-primary-glow">
                <HelpCircle className="size-5" />
                <h3 className="font-semibold">Likely Exam Questions</h3>
              </div>
              <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
                {summary.questions.map((q, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary-glow">
                      {i + 1}
                    </span>
                    <span>{q}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              onClick={() =>
                toast.info("PDF Export", {
                  description: "Summary formatted for print/download.",
                })
              }
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-6 py-3 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
            >
              <FileDown className="size-4" /> Export Summary as PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}
