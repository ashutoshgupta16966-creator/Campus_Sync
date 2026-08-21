export interface AtsAnalysisResult {
  score: number;
  wordCount: number;
  detectedKeywords: string[];
  missingKeywords: string[];
  detectedSections: string[];
  missingSections: string[];
  strengths: string[];
  recommendations: string[];
}

const TECH_KEYWORDS = [
  "React",
  "TypeScript",
  "JavaScript",
  "Python",
  "Java",
  "C++",
  "Node.js",
  "Express",
  "Next.js",
  "SQL",
  "PostgreSQL",
  "MongoDB",
  "Redis",
  "AWS",
  "Docker",
  "Kubernetes",
  "Git",
  "CI/CD",
  "REST APIs",
  "GraphQL",
  "System Design",
  "Data Structures",
  "Algorithms",
  "Unit Testing",
  "Jest",
  "Agile/Scrum",
  "HTML",
  "CSS",
  "Tailwind",
  "Redux",
  "Linux",
  "Microservices",
  "Figma",
  "UI/UX",
];

const STANDARD_SECTIONS = [
  { name: "Professional Summary", keys: ["summary", "profile", "objective", "about"] },
  { name: "Work Experience / Internships", keys: ["experience", "employment", "internship", "history", "work"] },
  { name: "Projects", keys: ["project", "projects", "open source", "portfolio"] },
  { name: "Education", keys: ["education", "academic", "university", "college", "degree", "b.tech", "bachelor"] },
  { name: "Technical Skills", keys: ["skills", "technologies", "competencies", "tools", "stack"] },
  { name: "Certifications & Links", keys: ["certif", "credentials", "github", "linkedin", "courses", "achievements"] },
];

const ACTION_VERBS = [
  "developed", "built", "designed", "implemented", "spearheaded", "architected",
  "optimized", "increased", "decreased", "reduced", "led", "created", "automated",
  "integrated", "engineered", "scaled", "improved", "launched", "refactored"
];

export function analyzeResumeText(text: string): AtsAnalysisResult {
  if (!text || text.trim().length === 0) {
    return {
      score: 0,
      wordCount: 0,
      detectedKeywords: [],
      missingKeywords: TECH_KEYWORDS.slice(0, 6),
      detectedSections: [],
      missingSections: STANDARD_SECTIONS.map((s) => s.name),
      strengths: ["Upload a detailed resume file to evaluate ATS performance."],
      recommendations: ["Ensure your file is in readable PDF, DOCX, or TXT format."],
    };
  }

  const cleanText = text.replace(/\s+/g, " ");
  const lowerText = cleanText.toLowerCase();
  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // 1. Keyword Matching
  const detectedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  TECH_KEYWORDS.forEach((kw) => {
    // Regex for keyword match with word boundaries
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(?:^|\\b|\\W)${escaped}(?:$|\\b|\\W)`, "i");
    if (regex.test(cleanText)) {
      detectedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  });

  // 2. Section Detection
  const detectedSections: string[] = [];
  const missingSections: string[] = [];

  STANDARD_SECTIONS.forEach((sec) => {
    const found = sec.keys.some((k) => lowerText.includes(k));
    if (found) {
      detectedSections.push(sec.name);
    } else {
      missingSections.push(sec.name);
    }
  });

  // 3. Metrics & Action Verbs Detection
  const metricsMatches = (cleanText.match(/\b\d+(?:[\.,]\d+)?%|\$\d+|\b\d+\+|\b\d+x\b|₹\d+|\b\d+\s*(?:ms|sec|users|customers|clients|projects|kb|mb|gb|tb|hrs)\b/gi) || []);
  const actionVerbsFound = ACTION_VERBS.filter((verb) => lowerText.includes(verb));

  // 4. Scoring Algorithm (0-100)
  // a) Keyword Score (Max 35)
  const keywordRatio = Math.min(detectedKeywords.length / 10, 1);
  const keywordScore = Math.round(keywordRatio * 35);

  // b) Section Score (Max 25)
  const sectionRatio = detectedSections.length / STANDARD_SECTIONS.length;
  const sectionScore = Math.round(sectionRatio * 25);

  // c) Metrics & Impact Score (Max 20)
  const metricsPoints = Math.min(metricsMatches.length * 4, 12);
  const verbPoints = Math.min(actionVerbsFound.length * 2, 8);
  const impactScore = metricsPoints + verbPoints;

  // d) Word Count & Format Score (Max 20)
  let formatScore = 0;
  if (wordCount >= 200 && wordCount <= 900) {
    formatScore = 20;
  } else if (wordCount >= 100 && wordCount < 200) {
    formatScore = 12;
  } else if (wordCount > 900 && wordCount <= 1500) {
    formatScore = 14;
  } else {
    formatScore = 5;
  }

  const totalScore = Math.min(Math.max(keywordScore + sectionScore + impactScore + formatScore, 0), 100);

  // 5. Generate Dynamic Strengths
  const strengths: string[] = [];

  if (detectedKeywords.length > 0) {
    strengths.push(`Matches ${detectedKeywords.length} core technical keywords (${detectedKeywords.slice(0, 5).join(", ")}${detectedKeywords.length > 5 ? "..." : ""})`);
  }
  if (detectedSections.length >= 4) {
    strengths.push(`Contains ${detectedSections.length} essential resume sections for reliable ATS parsing`);
  }
  if (metricsMatches.length > 0) {
    strengths.push(`Includes ${metricsMatches.length} quantified impact metrics and data points`);
  } else {
    strengths.push("Readable text formatting parsed cleanly by the extraction engine");
  }
  if (wordCount >= 200 && wordCount <= 900) {
    strengths.push(`Optimal document length (${wordCount} words) suitable for single-page ATS scanning`);
  }
  if (actionVerbsFound.length > 0) {
    strengths.push(`Uses strong action verbs (${actionVerbsFound.slice(0, 4).join(", ")})`);
  }

  // 6. Generate Dynamic Recommendations
  const recommendations: string[] = [];

  if (missingKeywords.length > 0) {
    const suggested = missingKeywords.slice(0, 4).join(", ");
    recommendations.push(`Incorporate key industry skills like ${suggested} into your skills block.`);
  }

  if (metricsMatches.length < 3) {
    recommendations.push("Quantify your project and work achievements with specific metrics (e.g. %, users, latency, volume).");
  }

  if (missingSections.length > 0) {
    recommendations.push(`Add missing sections: ${missingSections.slice(0, 2).join(" and ")} to ensure full ATS section coverage.`);
  } else {
    recommendations.push("Keep project descriptions focused on quantifiable technical impact and modern tech stacks.");
  }

  return {
    score: totalScore,
    wordCount,
    detectedKeywords,
    missingKeywords: missingKeywords.slice(0, 8),
    detectedSections,
    missingSections,
    strengths: strengths.length > 0 ? strengths : ["Text extracted successfully."],
    recommendations: recommendations.length > 0 ? recommendations : ["Review formatting and tailor skills to target role requirements."],
  };
}
