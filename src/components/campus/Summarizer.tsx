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
  CheckCircle2,
  Tag,
  AlertTriangle,
} from "lucide-react";
import {
  extractTextFromFiles,
  fileToBase64,
  isImageFile,
} from "@/lib/fileParser";
import {
  generateSummaryFromText,
  type SummaryResult,
  type ImageData,
} from "@/lib/summarizerEngine";

const ACCEPTED = ".pdf,.txt,.png,.jpg,.jpeg,.webp,.doc,.docx";
const ACCEPTED_LABEL = "PDF, TXT, DOC, PNG, JPG, WEBP";

// ─── FileChip ─────────────────────────────────────────────────────────────

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImg = isImageFile(file);
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 pl-2.5 pr-1.5 py-1 text-xs">
      {isImg ? (
        <ImageIcon className="size-3 text-primary-glow" />
      ) : (
        <FileText className="size-3 text-primary-glow" />
      )}
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

// ─── Summarizer Component ─────────────────────────────────────────────────

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
    const imagesToProcess: ImageData[] = [];

    const imageFiles = filesToProcess.filter(isImageFile);
    const docFiles = filesToProcess.filter((f) => !isImageFile(f));

    // 1. Process document files (.pdf, .docx, .txt)
    if (docFiles.length > 0) {
      setParsing(true);
      setParseStatus(`Reading ${docFiles.length} document${docFiles.length > 1 ? "s" : ""}…`);
      try {
        const extracted = await extractTextFromFiles(docFiles, (status) => {
          setParseStatus(status);
        });
        if (extracted) {
          combinedText = (combinedText ? combinedText + "\n\n" : "") + extracted;
          setNotes(combinedText);
        }
      } catch (err: any) {
        setParsing(false);
        toast.error("Document parsing failed", {
          description: err.message || "Could not read text from uploaded documents.",
        });
        return;
      } finally {
        setParsing(false);
      }
    }

    // 2. Prepare images for native Gemini Multimodal Vision API (no dead OCR!)
    if (imageFiles.length > 0) {
      setParsing(true);
      setParseStatus(`Preparing ${imageFiles.length} image scan${imageFiles.length > 1 ? "s" : ""} for Gemini Vision…`);
      try {
        const converted = await Promise.all(imageFiles.map((file) => fileToBase64(file)));
        for (const item of converted) {
          imagesToProcess.push({
            mimeType: item.mimeType,
            data: item.data,
          });
        }
      } catch (err: any) {
        setParsing(false);
        toast.error("Image preparation failed", {
          description: err.message || "Failed to load image file.",
        });
        return;
      } finally {
        setParsing(false);
      }
    }

    if (!combinedText.trim() && imagesToProcess.length === 0) {
      toast.error("No content to organize", {
        description: "Please upload an image/document or paste your notes.",
      });
      return;
    }

    // 3. Call server-side Gemini AI with strict extraction prompt
    setLoading(true);
    setParseStatus(
      imagesToProcess.length > 0
        ? "Analyzing handwritten/printed notes image with Gemini Vision…"
        : "Extracting points with Gemini AI…"
    );

    try {
      const result = await generateSummaryFromText(
        combinedText,
        imagesToProcess,
        (status) => setParseStatus(status)
      );
      setSummary(result);

      if (result.unreadableMessage) {
        toast.warning("Unclear notes detected", {
          description: result.unreadableMessage,
        });
      } else {
        toast.success("Notes organized!", {
          description: "Strictly extracted visible content without hallucinations.",
        });
      }
    } catch (err: any) {
      console.error("[CampusSync Summarizer] Error:", err);
      toast.error("Organizing notes failed", {
        description: err.message || "Failed to process notes with Gemini.",
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
    if (summary.unreadableMessage) {
      navigator.clipboard?.writeText(summary.unreadableMessage).catch(() => {});
      toast.success("Copied to clipboard");
      return;
    }

    const lines: string[] = [
      "## Key Concepts / Topics",
      ...(summary.keyConcepts.length > 0
        ? summary.keyConcepts.map((k) => `• ${k}`)
        : ["(None specified)"]),
      "",
      "## Important Points",
      ...(summary.importantPoints.length > 0
        ? summary.importantPoints.map((p) => `• ${p}`)
        : ["(None specified)"]),
      "",
      "## Keywords / Terms",
      ...(summary.keywords.length > 0
        ? summary.keywords.map((k) => `• ${k}`)
        : ["(None specified)"]),
    ];

    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
    toast.success("Organized notes copied to clipboard");
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
              Upload notes or photo scans — extracts strictly visible content without guessing or hallucinating.
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
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={
            "flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed p-6 text-center transition select-none " +
            (dragging
              ? "border-primary bg-primary/5 glow-ring"
              : "border-border bg-secondary/20 hover:border-primary/50")
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
            Drag & drop handwritten or printed notes
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ACCEPTED_LABEL} — Direct multimodal vision enabled
          </p>
        </div>

        {/* ── Camera button ── */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            cameraInputRef.current?.click();
          }}
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
            Manual notes / additional text context (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Type or paste study notes here, or upload an image above to extract directly…"
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
            {parsing ? "Preparing Files…" : loading ? "Extracting & Organizing…" : "Organize Notes"}
          </button>

          {summary && (
            <button
              onClick={copySummary}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-5 py-2.5 text-sm font-medium transition hover:bg-secondary"
            >
              <Copy className="size-4" /> Copy Output
            </button>
          )}
        </div>
      </div>

      {/* ── Loading overlay ── */}
      {(loading || parsing) && !summary && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-14 text-center">
          <Loader2 className="size-8 animate-spin text-primary-glow" />
          <p className="mt-4 font-medium text-foreground">
            {parsing ? parseStatus : "Reading image with Gemini Vision and organizing actual points…"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Extracting only visible content — strictly no hallucinations or assumptions.
          </p>
        </div>
      )}

      {/* ── Empty placeholder ── */}
      {!loading && !parsing && !summary && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-secondary/80 text-primary-glow">
            <BookOpen className="size-8" />
          </div>
          <h3 className="mt-4 text-xl font-bold">No Notes Organized Yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Upload handwritten notebook photos, lecture PDFs, or paste notes to generate clean, factual points.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-5 py-2 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
            >
              <UploadCloud className="size-4" /> Upload Notes / Photos
            </button>
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-5 py-2 text-sm font-medium transition hover:bg-secondary"
            >
              <Camera className="size-4" /> Snap Photo
            </button>
          </div>
        </div>
      )}

      {/* ── Output Structure (Strict 3 Sections) ── */}
      {summary && !loading && !parsing && (
        <div className="space-y-5">
          {summary.unreadableMessage ? (
            <div className="glass rounded-3xl border border-amber-500/40 bg-amber-500/10 p-6">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertTriangle className="size-5" />
                <h3 className="font-semibold">Unreadable Image</h3>
              </div>
              <p className="mt-2 text-sm text-foreground">
                {summary.unreadableMessage}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Please upload a higher resolution or better-lit photo of your handwritten or printed notes.
              </p>
            </div>
          ) : (
            <>
              {/* ## Key Concepts / Topics */}
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center gap-2 text-primary-glow">
                  <BookOpen className="size-5" />
                  <h3 className="font-semibold">Key Concepts / Topics</h3>
                </div>
                {summary.keyConcepts.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {summary.keyConcepts.map((concept, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-glow" />
                        <span className="font-medium">{concept}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No specific topic headings found in notes.
                  </p>
                )}
              </div>

              {/* ## Important Points */}
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center gap-2 text-primary-glow">
                  <CheckCircle2 className="size-5" />
                  <h3 className="font-semibold">Important Points</h3>
                </div>
                {summary.importantPoints.length > 0 ? (
                  <ul className="mt-4 space-y-3">
                    {summary.importantPoints.map((point, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-secondary/30 p-3.5 text-sm leading-relaxed text-foreground">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary-glow">
                          {i + 1}
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No bullet points extracted.
                  </p>
                )}
              </div>

              {/* ## Keywords / Terms */}
              <div className="glass rounded-3xl p-6">
                <div className="flex items-center gap-2 text-primary-glow">
                  <Tag className="size-5" />
                  <h3 className="font-semibold">Keywords / Terms</h3>
                </div>
                {summary.keywords.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {summary.keywords.map((term, i) => (
                      <span
                        key={i}
                        className="rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary-glow"
                      >
                        {term}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No distinct keywords identified in notes.
                  </p>
                )}
              </div>

              {/* Action: Copy */}
              <div className="flex justify-center">
                <button
                  onClick={copySummary}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-6 py-3 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
                >
                  <Copy className="size-4" /> Copy Organized Notes
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
