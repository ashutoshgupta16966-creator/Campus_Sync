import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  UploadCloud,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Highlighter,
  LayoutList,
  Sparkles,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import { extractTextFromFile } from "@/lib/fileParser";
import { analyzeResumeText, type AtsAnalysisResult } from "@/lib/atsAnalyzer";

function Gauge({ score }: { score: number }) {
  const r = 78;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-52">
      <svg viewBox="0 0 180 180" className="size-full -rotate-90">
        <circle cx="90" cy="90" r={r} className="fill-none stroke-secondary" strokeWidth="14" />
        <circle
          cx="90"
          cy="90"
          r={r}
          className="fill-none stroke-[url(#g)] transition-[stroke-dashoffset] duration-1000 ease-out"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * score) / 100}
        />
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.62 0.21 285)" />
            <stop offset="100%" stopColor="oklch(0.72 0.19 305)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-gradient">{score} / 100</span>
        <span className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
          ATS Score
        </span>
      </div>
    </div>
  );
}

export function AtsChecker() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const [result, setResult] = useState<AtsAnalysisResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setResult(null);
    toast.success("File selected", { description: `${file.name} ready for analysis.` });
  };

  const processAnalysis = async (fileToAnalyze: File) => {
    setLoading(true);
    setParseStatus("Reading resume file…");
    try {
      const extractedText = await extractTextFromFile(fileToAnalyze, (status) => {
        setParseStatus(status);
      });

      if (!extractedText || extractedText.trim().length < 10) {
        throw new Error("No readable text found in the file. Please try another file.");
      }

      setParseStatus("Matching keywords & computing ATS score…");
      const analysis = analyzeResumeText(extractedText);
      setResult(analysis);
      toast.success("Analysis complete", {
        description: `Your resume scored ${analysis.score} / 100 based on parsed text.`,
      });
    } catch (err: any) {
      console.error("Resume analysis error:", err);
      toast.error("Analysis failed", {
        description: err.message || "Could not parse text from uploaded resume.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!selectedFile) {
      toast.error("Please upload a resume file first");
      inputRef.current?.click();
      return;
    }
    processAnalysis(selectedFile);
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
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
          if (f) {
            handleFileSelect(f);
            processAnalysis(f);
          }
        }}
        onClick={() => inputRef.current?.click()}
        className={
          "glass flex cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed p-10 text-center transition " +
          (dragging ? "border-primary glow-ring" : "border-border hover:border-primary/50")
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              handleFileSelect(f);
              processAnalysis(f);
            }
          }}
        />
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary-glow">
          {selectedFile ? <FileText className="size-7" /> : <UploadCloud className="size-7" />}
        </div>
        <p className="mt-4 font-semibold">
          {selectedFile ? selectedFile.name : "Drag & drop your resume here"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {selectedFile
            ? `${(selectedFile.size / 1024).toFixed(1)} KB — Click to replace file`
            : "Supports PDF, DOCX, or TXT — or click to browse files"}
        </p>
        <button
          onClick={handleAnalyzeClick}
          disabled={loading}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-linear-to-r from-primary to-primary-glow px-6 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {loading ? "Analyzing File…" : selectedFile ? "Analyze Resume Now" : "Upload File to Analyze"}
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-14 text-center">
          <Loader2 className="size-8 animate-spin text-primary-glow" />
          <p className="mt-4 font-medium text-foreground">{parseStatus}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Parsing document structure, identifying technical keywords, and scanning sections…
          </p>
        </div>
      )}

      {/* Initial Empty State Placeholder */}
      {!loading && !result && (
        <div className="glass flex flex-col items-center justify-center rounded-3xl p-12 text-center">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-secondary/80 text-primary-glow">
            <BarChart3 className="size-8" />
          </div>
          <h3 className="mt-4 text-xl font-bold">No Resume Analyzed Yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Upload your resume file (PDF, DOCX, or TXT) above to perform a dynamic ATS content scan, keyword match calculation, and personalized formatting analysis.
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-6 py-2.5 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
          >
            <UploadCloud className="size-4" /> Upload File to Analyze
          </button>
        </div>
      )}

      {/* Dynamic Results Display */}
      {result && !loading && (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Score Card */}
            <div className="glass flex flex-col items-center justify-center rounded-3xl p-8">
              <Gauge score={result.score} />
              <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-linear-to-r from-primary to-primary-glow transition-all duration-1000"
                  style={{ width: `${result.score}%` }}
                />
              </div>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {result.score >= 80
                  ? "Excellent! Your resume matches strong industry ATS criteria."
                  : result.score >= 60
                  ? "Solid content draft. Closing missing keywords and section gaps below will boost your score past 85+."
                  : "Needs work. Add technical keywords, quantified metrics, and standard section headers to improve ATS readability."}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="size-4 text-primary-glow" />
                <span>Parsed Word Count: {result.wordCount} words</span>
              </div>
            </div>

            {/* Strengths Found */}
            <div className="glass rounded-3xl p-6">
              <h3 className="flex items-center gap-2 font-semibold text-success">
                <CheckCircle2 className="size-5" /> Strengths Found ({result.strengths.length})
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                {result.strengths.map((s, idx) => (
                  <li key={idx} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Missing Keywords & Sections */}
            <div className="space-y-5">
              <div className="glass rounded-3xl p-6">
                <h3 className="flex items-center gap-2 font-semibold text-destructive">
                  <XCircle className="size-5" /> Missing Keywords ({result.missingKeywords.length})
                </h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {result.missingKeywords.length > 0 ? (
                    result.missingKeywords.map((m) => (
                      <span
                        key={m}
                        className="rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
                      >
                        {m}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">Great job! All core technical keywords detected.</span>
                  )}
                </div>
              </div>

              <div className="glass rounded-3xl p-6">
                <h3 className="flex items-center gap-2 font-semibold text-accent">
                  <LayoutList className="size-5" /> Missing Sections ({result.missingSections.length})
                </h3>
                {result.missingSections.length > 0 ? (
                  <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                    {result.missingSections.map((m) => (
                      <li key={m} className="flex gap-2">
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    All standard resume sections detected reliably!
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actionable Recommendations */}
          <div className="glass rounded-3xl p-6">
            <h3 className="font-semibold">Actionable Recommendations</h3>
            <ol className="mt-4 grid gap-4 md:grid-cols-3">
              {result.recommendations.map((r, i) => (
                <li
                  key={i}
                  className="rounded-2xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary-glow">
                    <ArrowRight className="size-4" /> Step {i + 1}
                  </span>
                  <p className="mt-2">{r}</p>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex justify-center">
            <button
              onClick={() =>
                toast.info("Keywords Highlighted", {
                  description: `Found ${result.detectedKeywords.length} technical keywords: ${result.detectedKeywords.join(", ")}`,
                })
              }
              className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-6 py-3 text-sm font-semibold text-primary-glow transition hover:bg-primary/25"
            >
              <Highlighter className="size-4" /> View Detected Keywords ({result.detectedKeywords.length})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
