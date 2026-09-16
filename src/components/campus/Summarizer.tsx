import { useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Copy,
  FileDown,
  UploadCloud,
  BookOpen,
  Camera,
  X,
  FileText,
  Image as ImageIcon,
  ClipboardList,
  Lightbulb,
  Brain,
  AlignLeft,
} from "lucide-react";
import { extractTextFromFiles } from "@/lib/fileParser";
import {
  generateSummaryFromText,
  type SummaryResult,
} from "@/lib/summarizerEngine";

const ACCEPTED = ".pdf,.txt,.png,.jpg,.jpeg,.webp,.doc,.docx";
const ACCEPTED_LABEL = "PDF, TXT, DOC, PNG, JPG, WEBP";

// ─── FileChip ─────────────────────────────────────────────────────────────

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 pl-2.5 pr-1.5 py-1 text-xs">
      {isImage ? <ImageIcon className="size-3 text-primary-glow" /> : <FileText className="size-3 text-primary-glow" />}
      <span className="max-w-[140px] truncate font-medium">{file.name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 flex size-4 items-center justify-center rounded-full hover:bg-destructive/20 hover:text-destructive transition"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

// ─── Summarizer ───────────────────────────────────────────────────────────

export function Summarizer() {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ── file handling ──────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles || newFiles.length === 0) return;
    const arr = Array.from(newFiles);
    setUploadedFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const unique = arr.filter((f) => !existingNames.has(f.name));
      return [...prev, ...unique];
    });
  }, []);

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setUploadedFiles([]);
    setNotes("");
    setSummary(null);
  };

  // ── main processing ────────────────────────────────────────────────────

  const processAndSummarize = async (filesToProcess: File[], textFallback: string) => {
    let combinedText = textFallback.trim();

    // Extract text if files are uploaded
    if (filesToProcess.length > 0) {
      setParsing(true);
      setParseStatus(`Extracting text from ${filesToProcess.length} file${filesToProcess.length > 1 ? "s" : ""}…`);
      try {
        const extracted = await extractTextFromFiles(filesToProcess, (status) => {
          setParseStatus(status);
        });
        combinedText = extracted + (textFallback ? "\n\n" + textFallback : "");
        setNotes(combinedText);
        toast.success("Text extracted", {
          description: `Extracted ${filesToProcess.length} file${filesToProcess.length > 1 ? "s" : ""}. Generating summary…`,
        });
      } catch (err: any) {
        setParsing(false);
        toast.error("Text extraction failed", {
          description: err.message || "Could not extract text from uploaded files.",
        });
        return;
      } finally {
        setParsing(false);
      }
    }

    if (!combinedText.trim()) {
      toast.error("No content to summarize", {
        description: "Please upload files or paste notes below.",
      });
      return;
    }

    // Call server-side Gemini AI Summarizer
    setLoading(true);
    setParseStatus("Analyzing notes with Gemini AI…");

    try {
      const result = await generateSummaryFromText(
        combinedText,
        (status) => setParseStatus(status)
      );
      setSummary(result);
      toast.success("Summary ready!", {
        description: "Study cards generated from your notes.",
      });
    } catch (err: any) {
      console.error("[CampusSync Summarizer] Error:", err);
      toast.error("AI Summarization Failed", {
        description: err.message || "Failed to generate summary with Gemini.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = () => {
    processAndSummarize(uploadedFiles, notes);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  // ── copy ──────────────────────────────────────────────────────────────

  const copySummary = () => {
    if (!summary) return;
    const lines = [
      "📌 QUICK OVERVIEW",
      summary.overview,
      "",
      "🔑 KEY CONCEPTS & TAKEAWAYS",
      ...summary.takeaways.map((t, i) => `${i + 1}. ${t}`),
      "",
      "💡 IMPORTANT DEFINITIONS / FORMULAS",
      ...summary.formulas.map((f) => `${f.name}: ${f.body}`),
      "",
      "🧠 REVISION NOTES",
      ...summary.examPoints.map((p) => `• ${p}`),
    ];
    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
    toast.success("Summary copied to clipboard");
  };

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Input Block ── */}
      <div className="glass rounded-3xl p-5 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">AI Notes Summarizer</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload files, snap notes with your camera, or paste text — get structured study cards instantly.
            </p>
          </div>

          {(uploadedFiles.length > 0 || notes || summary) && (
            <button
              onClick={clearAll}
              className="shrink-0 flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-destructive/50 hover:text-destructive transition"
            >
              <X className="size-3" /> Clear all
            </button>
          )}
        </div>

        {/* ── Dropzone ── */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed p-6 text-center transition select-none " +
            (dragging ? "border-primary bg-primary/5 glow-ring" : "border-border bg-secondary/20 hover:border-primary/50")
          }
        >
          {/* hidden multi-file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          {/* hidden camera input */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />

          <div className="flex gap-3 text-primary-glow">
            <UploadCloud className="size-7" />
            <ImageIcon className="size-7" />
            <FileText className="size-7" />
          </div>
          <p className="mt-2 text-sm font-semibold">
            Drag & drop or click to upload files
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ACCEPTED_LABEL} — multiple documents & images supported
          </p>
        </div>

        {/* ── Camera button ── */}
        <button
          onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click(); }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/30 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
        >
          <Camera className="size-4 text-primary-glow" />
          Snap Notes with Camera (mobile)
        </button>

        {/* ── File chips ── */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {uploadedFiles.map((f, i) => (
              <FileChip key={`${f.name}-${i}`} file={f} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        {/* ── Parse / AI status bar ── */}
        {(parsing || loading) && (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-primary-glow" />
            <span>{parseStatus}</span>
          </div>
        )}

        {/* ── Notes textarea ── */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Extracted text / manual notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            placeholder="Parsed text from your uploaded documents or camera scans will appear here, or paste your notes directly…"
            className="w-full resize-y rounded-2xl border border-border bg-secondary/40 p-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/40"
          />
        </div>

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={loading || parsing}
            className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary to-primary-glow px-6 py-2.5 text-sm font-semibold text-primary-foreground glow-ring transition hover:opacity-90 disabled:opacity-60"
          >
            {loading || parsing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {parsing ? "Extracting Text…" : loading ? "Generating AI Summary…" : "Generate Summary"}
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

      {/* ── Loading overlay ── */}
      {(loading || parsing) && !summary && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-14 text-center">
          <Loader2 className="size-8 animate-spin text-primary-glow" />
          <p className="mt-4 font-medium text-foreground">
            {parsing ? parseStatus : "Analyzing notes with Gemini AI and structuring study cards…"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Extracting key concepts, step-by-step breakdown, formulas, and revision points…
          </p>
        </div>
      )}

      {/* ── Empty placeholder ── */}
      {!loading && !parsing && !summary && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-secondary/80 text-primary-glow">
            <BookOpen className="size-8" />
          </div>
          <h3 className="mt-4 text-xl font-bold">No Summary Generated Yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Upload lecture PDFs, snap photos of board notes, or paste text above to generate structured study cards.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-5 py-2 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
            >
              <UploadCloud className="size-4" /> Upload Files
            </button>
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-5 py-2 text-sm font-medium transition hover:bg-secondary"
            >
              <Camera className="size-4" /> Use Camera
            </button>
          </div>
        </div>
      )}

      {/* ── Summary Output ── */}
      {summary && !loading && !parsing && (
        <div className="space-y-5">
          {/* 📌 Quick Overview */}
          <div className="glass rounded-3xl p-6">
            <div className="flex items-center gap-2 text-primary-glow">
              <AlignLeft className="size-5" />
              <h3 className="font-semibold">📌 Quick Overview</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
              {summary.overview}
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* 🔑 Key Concepts & Takeaways */}
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center gap-2 text-primary-glow">
                <ClipboardList className="size-5" />
                <h3 className="font-semibold">🔑 Key Concepts & Takeaways</h3>
              </div>
              {summary.takeaways.length > 0 ? (
                <ol className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                  {summary.takeaways.map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary-glow">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{t}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No key concepts extracted.</p>
              )}
            </div>

            {/* 💡 Important Definitions / Formulas */}
            <div className="glass rounded-3xl p-6">
              <div className="flex items-center gap-2 text-primary-glow">
                <Lightbulb className="size-5" />
                <h3 className="font-semibold">💡 Important Definitions / Formulas</h3>
              </div>
              {summary.formulas.length > 0 ? (
                <ul className="mt-4 space-y-2.5">
                  {summary.formulas.map((f, i) => (
                    <li key={i} className="rounded-xl border border-border bg-secondary/40 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-glow">
                        {f.name}
                      </p>
                      <p className="mt-1 font-mono text-sm text-foreground">{f.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No explicit definitions or formulas detected.</p>
              )}
            </div>
          </div>

          {/* 🧠 Revision Notes */}
          <div className="glass rounded-3xl p-6">
            <div className="flex items-center gap-2 text-primary-glow">
              <Brain className="size-5" />
              <h3 className="font-semibold">🧠 Revision Notes</h3>
            </div>
            {summary.examPoints.length > 0 ? (
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {summary.examPoints.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-glow" />
                    <span className="leading-relaxed">{p}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">No revision points extracted.</p>
            )}
          </div>

          {/* Export button */}
          <div className="flex justify-center">
            <button
              onClick={() => toast.info("PDF Export", { description: "Summary ready for download/print." })}
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-6 py-3 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
            >
              <FileDown className="size-4" /> Export Summary as PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
