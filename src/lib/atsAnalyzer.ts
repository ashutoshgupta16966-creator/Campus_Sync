export interface AtsAnalysisResult {
  score: number;
  wordCount: number;
  extractedText: string;
  detectedKeywords: string[];
  missingKeywords: string[];
  detectedSections: string[];
  missingSections: string[];
  strengths: string[];
  recommendations: string[];
}

// Target Industry Keywords (Technical & Soft Skills)
const TARGET_KEYWORDS = [
  // Languages
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C++",
  "C#",
  "Go",
  "Rust",
  "HTML",
  "CSS",
  "SQL",

  // Frameworks & Libraries
  "React",
  "Next.js",
  "Node.js",
  "Express",
  "Vue",
  "Angular",
  "Django",
  "FastAPI",
  "Tailwind",
  "Redux",
  "Bootstrap",

  // Databases & Cloud
  "PostgreSQL",
  "MongoDB",
  "MySQL",
  "Redis",
  "Firebase",
  "AWS",
  "GCP",
  "Azure",
  "Docker",
  "Kubernetes",

  // Developer Tools & Practices
  "Git",
  "GitHub",
  "CI/CD",
  "REST APIs",
  "GraphQL",
  "System Design",
  "Microservices",
  "Agile/Scrum",
  "Linux",
  "Unit Testing",
  "Jest",
  "Figma",
  "UI/UX",
  "Data Structures",
  "Algorithms",

  // Soft Skills
  "Problem Solving",
  "Communication",
  "Leadership",
  "Teamwork",
  "Collaboration",
];

const STANDARD_SECTIONS = [
  { name: "Contact Information", keys: ["email", "phone", "mobile", "linkedin", "github", "contact", "@"] },
  { name: "Professional Summary", keys: ["summary", "profile", "objective", "about me", "about"] },
  { name: "Work Experience / Internships", keys: ["experience", "employment", "internship", "work history", "history", "position", "work"] },
  { name: "Projects", keys: ["project", "projects", "open source", "portfolio", "key projects"] },
  { name: "Education", keys: ["education", "academic", "university", "college", "degree", "b.tech", "bachelor", "master", "gpa", "cgpa"] },
  { name: "Technical Skills", keys: ["skills", "technologies", "competencies", "tools", "stack", "technical skills"] },
  { name: "Certifications & Achievements", keys: ["certif", "credentials", "courses", "achievements", "awards", "licenses"] },
];

const ACTION_VERBS = [
  "developed", "built", "designed", "implemented", "spearheaded", "architected",
  "optimized", "increased", "decreased", "reduced", "led", "created", "automated",
  "integrated", "engineered", "scaled", "improved", "launched", "refactored", "managed"
];

export function analyzeResumeText(text: string): AtsAnalysisResult {
  if (!text || text.trim().length === 0) {
    return {
      score: 0,
      wordCount: 0,
      extractedText: "",
      detectedKeywords: [],
      missingKeywords: TARGET_KEYWORDS.slice(0, 10),
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

  // 1. Dynamic Keyword Detection (Case-insensitive)
  const detectedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  TARGET_KEYWORDS.forEach((kw) => {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    // Word boundary regex allowing for special chars like C++, C#, Node.js
    const regex = new RegExp(`(?:^|\\b|\\W)${escaped}(?:$|\\b|\\W)`, "i");
    if (regex.test(cleanText)) {
      detectedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  });

  // 2. Dynamic Section Detection
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

  // 3. Dynamic Quantified Impact & Action Verbs
  const metricsMatches = (cleanText.match(/\b\d+(?:[\.,]\d+)?%|\$\d+|\b\d+\+|\b\d+x\b|₹\d+|\b\d+\s*(?:ms|sec|users|customers|clients|projects|kb|mb|gb|tb|hrs)\b/gi) || []);
  const actionVerbsFound = ACTION_VERBS.filter((verb) => lowerText.includes(verb));

  // 4. Dynamic ATS Score Calculation (0-100)
  // a) Keyword Match Score (Max 40 points)
  // Target benchmark: finding 12+ keywords gets full 40 points
  const keywordTarget = Math.min(detectedKeywords.length / 12, 1);
  const keywordScore = Math.round(keywordTarget * 40);

  // b) Section Completeness Score (Max 30 points)
  const sectionRatio = detectedSections.length / STANDARD_SECTIONS.length;
  const sectionScore = Math.round(sectionRatio * 30);

  // c) Word Count Appropriateness (Max 15 points)
  let wordCountScore = 0;
  if (wordCount >= 250 && wordCount <= 900) {
    wordCountScore = 15; // Optimal single page length
  } else if (wordCount >= 150 && wordCount < 250) {
    wordCountScore = 10;
  } else if (wordCount > 900 && wordCount <= 1400) {
    wordCountScore = 10; // Acceptable 2-page length
  } else {
    wordCountScore = 5; // Too brief or overly long
  }

  // d) Quantified Metrics & Action Verbs (Max 15 points)
  const metricsPoints = Math.min(metricsMatches.length * 3, 9);
  const verbPoints = Math.min(actionVerbsFound.length * 2, 6);
  const impactScore = metricsPoints + verbPoints;

  const totalScore = Math.min(100, Math.max(0, keywordScore + sectionScore + wordCountScore + impactScore));

  // 5. Dynamic Strengths Found
  const strengths: string[] = [];

  if (detectedKeywords.length > 0) {
    strengths.push(`Detected ${detectedKeywords.length} matching technical and soft skills (${detectedKeywords.slice(0, 6).join(", ")}${detectedKeywords.length > 6 ? "..." : ""})`);
  }
  if (detectedSections.length >= 4) {
    strengths.push(`Contains ${detectedSections.length} of ${STANDARD_SECTIONS.length} standard resume sections for reliable ATS parsing`);
  }
  if (metricsMatches.length > 0) {
    strengths.push(`Includes ${metricsMatches.length} quantified impact metrics and measurable data points`);
  }
  if (wordCount >= 250 && wordCount <= 900) {
    strengths.push(`Optimal document length (${wordCount} words) suitable for single-page ATS scanning`);
  }
  if (actionVerbsFound.length > 0) {
    strengths.push(`Uses strong action verbs (${actionVerbsFound.slice(0, 4).join(", ")})`);
  }

  // 6. Dynamic Actionable Recommendations
  const recommendations: string[] = [];

  if (missingKeywords.length > 0) {
    const suggested = missingKeywords.slice(0, 5).join(", ");
    recommendations.push(`Add target technical skills like ${suggested} to improve keyword match density.`);
  }

  if (metricsMatches.length < 3) {
    recommendations.push("Quantify your project and work achievements with specific numbers, percentages, or scale metrics.");
  }

  if (missingSections.length > 0) {
    recommendations.push(`Include missing standard sections: ${missingSections.slice(0, 2).join(" and ")}.`);
  } else {
    recommendations.push("Ensure project descriptions highlight modern tech stacks and quantifiable business outcomes.");
  }

  return {
    score: totalScore,
    wordCount,
    extractedText: cleanText,
    detectedKeywords,
    missingKeywords,
    detectedSections,
    missingSections,
    strengths: strengths.length > 0 ? strengths : ["Text parsed successfully."],
    recommendations: recommendations.length > 0 ? recommendations : ["Tailor keywords and bullet points to your target job position."],
  };
}
