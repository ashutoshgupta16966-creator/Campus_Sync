export interface FormulaItem {
  name: string;
  body: string;
}

export interface SummaryResult {
  takeaways: string[];
  formulas: FormulaItem[];
  questions: string[];
}

export function generateSummaryFromText(notes: string): SummaryResult {
  const cleanNotes = notes.trim();
  if (!cleanNotes) {
    return {
      takeaways: ["No lecture text provided yet."],
      formulas: [],
      questions: [],
    };
  }

  // Break text into sentences & paragraphs
  const rawSentences = cleanNotes
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);

  // 1. Extract Key Takeaways
  const takeaways: string[] = [];
  
  // Look for sentences with high-signal keywords (defines, law, system, process, key, main, result, equation, algorithm, function)
  const signalRegex = /\b(is|are|defined|law|theorem|system|process|key|main|result|equation|algorithm|function|energy|data|structure|principle|rule|efficiency|model|state|complexity)\b/i;

  const prioritySentences = rawSentences.filter((s) => signalRegex.test(s));
  const candidateList = prioritySentences.length >= 3 ? prioritySentences : rawSentences;

  for (let i = 0; i < candidateList.length && takeaways.length < 5; i++) {
    const s = candidateList[i];
    // Clean trailing or leading symbols
    const formatted = s.replace(/^[-•*1-9.\s]+/, "").trim();
    if (formatted.length > 20 && !takeaways.includes(formatted)) {
      takeaways.push(formatted.endsWith(".") ? formatted : formatted + ".");
    }
  }

  // Fallback if notes are very short
  if (takeaways.length === 0) {
    takeaways.push(cleanNotes.slice(0, 150) + (cleanNotes.length > 150 ? "…" : ""));
  }

  // 2. Extract Formulas / Core Equations / Definitions
  const formulas: FormulaItem[] = [];
  
  // Find lines containing mathematical / logical relations
  const formulaRegex = /([A-Za-z0-9_\s]{2,25})\s*[:=→]\s*([^.\n]{3,60})/g;
  const mathSymbolRegex = /[=∫∑Δηπ√±×÷^]/;

  const lines = cleanNotes.split(/\n+/);
  
  for (const line of lines) {
    if (formulas.length >= 4) break;
    const cleanLine = line.replace(/^[-•*]\s*/, "").trim();

    if (mathSymbolRegex.test(cleanLine) && cleanLine.length < 80) {
      const parts = cleanLine.split(/[:=]/);
      if (parts.length >= 2) {
        formulas.push({
          name: parts[0].trim().slice(0, 30),
          body: parts.slice(1).join("=").trim().slice(0, 50),
        });
      } else {
        formulas.push({
          name: "Key Equation",
          body: cleanLine.slice(0, 55),
        });
      }
    }
  }

  // Fallback formulas / definitions if no explicit equations found
  if (formulas.length === 0) {
    // Extract key term definitions "Term: definition" or "Term is ..."
    const termMatches = cleanNotes.match(/([A-Z][a-zA-Z0-9\s]{2,20})\s+(?:is|refers to|defines|means)\s+([^.]{10,60})/gi);
    if (termMatches) {
      termMatches.slice(0, 3).forEach((m, idx) => {
        const parts = m.split(/\s+(?:is|refers to|defines|means)\s+/i);
        if (parts.length >= 2) {
          formulas.push({
            name: parts[0].trim(),
            body: parts[1].trim(),
          });
        }
      });
    }
  }

  if (formulas.length === 0) {
    // Extract top 3 nouns / keywords for generic formula cards
    const words = cleanNotes.match(/\b[A-Z][a-z]{3,}\b/g) || ["Core Concept", "Primary Variable", "System Metric"];
    const uniqueWords = Array.from(new Set(words));
    formulas.push({
      name: uniqueWords[0] || "System State",
      body: "Primary condition governing system energy / data flow",
    });
    formulas.push({
      name: uniqueWords[1] || "Governing Relation",
      body: "Core relationship between inputs and output metrics",
    });
  }

  // 3. Generate Likely Exam Questions
  const questions: string[] = [];
  const topicWords = cleanNotes.match(/\b[A-Z][a-zA-Z0-9]{3,}\b/g) || [];
  const topTopics = Array.from(new Set(topicWords)).filter((w) => !["The", "This", "That", "With", "From", "Have", "Your"].includes(w));

  const topic1 = topTopics[0] || "the core topic";
  const topic2 = topTopics[1] || "the primary system components";
  const topic3 = topTopics[2] || "key efficiency metrics";

  questions.push(`Explain the fundamental principles of ${topic1} and derive its main working equations.`);
  questions.push(`Compare and contrast ${topic1} with ${topic2} in practical applications.`);
  questions.push(`How do changes in ${topic3} affect overall performance according to the lecture notes?`);

  return {
    takeaways,
    formulas,
    questions,
  };
}
