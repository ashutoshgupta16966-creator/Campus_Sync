export interface FormulaItem {
  name: string;
  body: string;
}

export interface SummaryResult {
  overview: string;          // 📌 Quick Overview
  takeaways: string[];       // 🔑 Key Concepts & Takeaways
  formulas: FormulaItem[];   // 💡 Important Definitions / Formulas
  examPoints: string[];      // 🧠 Exam/Revision Summary
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Split text into clean sentences. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, "\n")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.replace(/^[\s\-•*►▶→\d+.\)]+/, "").trim())
    .filter((s) => s.length > 20);
}

/** Split text into lines. */
function splitLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.replace(/^[\s\-•*►▶→\d+.\)]+/, "").trim())
    .filter((l) => l.length > 5);
}

/**
 * Score a sentence for informational density.
 * Higher = more likely to be a key concept.
 */
function scoreSentence(s: string): number {
  let score = 0;
  const lower = s.toLowerCase();

  // Concept-defining patterns
  if (/\b(is defined as|refers to|means that|is called|is known as)\b/i.test(s)) score += 4;
  if (/\b(is|are|was|were)\b/i.test(s)) score += 1;
  if (/\b(therefore|thus|hence|as a result|consequently|because|since)\b/i.test(s)) score += 2;
  if (/\b(first|second|third|finally|lastly|step|phase|stage)\b/i.test(s)) score += 2;
  if (/\b(important|key|critical|essential|fundamental|main|primary|major)\b/i.test(s)) score += 3;
  if (/\b(theorem|law|principle|rule|formula|equation|concept|theory)\b/i.test(s)) score += 3;
  if (/\b(algorithm|process|method|technique|approach|procedure)\b/i.test(s)) score += 2;
  if (/\d/.test(s)) score += 1; // Contains numbers

  // Penalise very short or very long sentences
  const words = s.split(/\s+/).length;
  if (words < 5) score -= 2;
  if (words > 50) score -= 1;

  return score;
}

/** Detect definition / formula lines. */
function extractDefinitionsAndFormulas(text: string): FormulaItem[] {
  const results: FormulaItem[] = [];
  const seen = new Set<string>();

  const lines = splitLines(text);
  const mathSymbol = /[=∫∑Δηπ√±×÷^≈≠≤≥∝∂∞]/;

  for (const line of lines) {
    if (results.length >= 5) break;
    if (line.length > 150) continue;

    // Pattern 1: "Term = expression" or "Term: expression"
    const colonEq = line.match(/^([^:=]{3,35})\s*[:=]\s*(.{5,80})$/);
    if (colonEq) {
      const name = colonEq[1].trim();
      const body = colonEq[2].trim();
      if (!seen.has(name.toLowerCase()) && (mathSymbol.test(body) || body.length > 8)) {
        seen.add(name.toLowerCase());
        results.push({ name, body });
        continue;
      }
    }

    // Pattern 2: lines with clear math symbols
    if (mathSymbol.test(line) && line.length < 100) {
      const parts = line.split(/[:=]/);
      const name = parts.length >= 2 ? parts[0].trim().slice(0, 35) : "Key Equation";
      const body = parts.length >= 2 ? parts.slice(1).join("=").trim().slice(0, 80) : line.slice(0, 80);
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        results.push({ name, body });
        continue;
      }
    }

    // Pattern 3: "Term is/means/refers to ..." definition
    const defMatch = line.match(/^([A-Z][a-zA-Z\s]{2,30})\s+(?:is|means|refers to|denotes|represents)\s+(.{10,100})/);
    if (defMatch) {
      const name = defMatch[1].trim();
      const body = defMatch[2].trim().replace(/\.$/, "");
      if (!seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        results.push({ name, body });
      }
    }
  }

  return results;
}

/** Generate a 2–3 line overview from the most informative sentences. */
function buildOverview(sentences: string[]): string {
  const scored = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .sort((a, b) => b.score - a.score);

  const picks = scored
    .slice(0, 3)
    .map((x) => x.s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 15);

  if (picks.length === 0) {
    return sentences.slice(0, 2).join(" ").slice(0, 200) + "…";
  }
  return picks.join(" ").slice(0, 350);
}

/** Extract top-N most informative sentences as key takeaways. */
function buildTakeaways(sentences: string[], n = 6): string[] {
  const scored = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const picks: string[] = [];

  for (const { s } of scored) {
    if (picks.length >= n) break;
    const key = s.slice(0, 40).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      const clean = s.replace(/\s+/g, " ").trim();
      picks.push(clean.endsWith(".") ? clean : clean + ".");
    }
  }

  // Fallback: use first N sentences
  if (picks.length < 3) {
    for (const s of sentences) {
      if (picks.length >= n) break;
      const clean = s.replace(/\s+/g, " ").trim();
      const ending = clean.endsWith(".") ? clean : clean + ".";
      if (!picks.includes(ending)) picks.push(ending);
    }
  }

  return picks;
}

/** Build short exam/revision bullet points. */
function buildExamPoints(sentences: string[], formulas: FormulaItem[]): string[] {
  const points: string[] = [];

  // Add formula-based points
  for (const f of formulas.slice(0, 3)) {
    points.push(`${f.name}: ${f.body}`);
  }

  // High-signal sentences kept SHORT (≤ 15 words)
  const scored = sentences
    .map((s) => ({ s, score: scoreSentence(s) }))
    .sort((a, b) => b.score - a.score);

  for (const { s } of scored) {
    if (points.length >= 7) break;
    const words = s.split(/\s+/);
    if (words.length <= 20) {
      const clean = s.replace(/\s+/g, " ").trim();
      const point = clean.endsWith(".") ? clean : clean + ".";
      if (!points.some((p) => p.startsWith(point.slice(0, 30)))) {
        points.push(point);
      }
    }
  }

  return points.slice(0, 7);
}

// ─── main export ─────────────────────────────────────────────────────────────

export function generateSummaryFromText(notes: string): SummaryResult {
  const cleanNotes = notes.trim().replace(/[ \t]+/g, " ");

  if (!cleanNotes || cleanNotes.length < 20) {
    return {
      overview: "No meaningful text provided. Please upload a file or paste lecture notes.",
      takeaways: [],
      formulas: [],
      examPoints: [],
    };
  }

  const sentences = splitSentences(cleanNotes);
  const formulas = extractDefinitionsAndFormulas(cleanNotes);
  const overview = buildOverview(sentences);
  const takeaways = buildTakeaways(sentences, 6);
  const examPoints = buildExamPoints(sentences, formulas);

  return { overview, takeaways, formulas, examPoints };
}
