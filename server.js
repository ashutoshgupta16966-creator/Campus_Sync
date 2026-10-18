import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ─── Static Asset Serving (from Vite/Nitro build output) ─────────────────────
// Serve compiled frontend assets at /assets/* so the browser can load
// JS/CSS chunks emitted by `vite build` into .output/public/assets/.
// This is needed when Render serves both the API and the frontend from the same service.
const PUBLIC_DIR = resolve(__dirname, '.output', 'public');
if (existsSync(PUBLIC_DIR)) {
  // Serve /assets/* with long-term caching headers (hashed filenames)
  app.use(
    '/assets',
    express.static(join(PUBLIC_DIR, 'assets'), {
      maxAge: '1y',
      immutable: true,
    })
  );
  // Serve favicon, robots.txt, and other root-level public files
  app.use(express.static(PUBLIC_DIR, { index: false }));
  console.log(`[CampusSync Backend] Serving static assets from ${PUBLIC_DIR}`);
} else {
  console.log('[CampusSync Backend] No .output/public directory found — API-only mode.');
}

// Enable CORS for all origins (frontend on Vercel, Render, or localhost)
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Support JSON and urlencoded bodies with large limits for notes and document data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// ─── 1. Health Check Routes ──────────────────────────────────────────────────

// Build the HTML app shell once at startup and cache it.
// Reads the hashed asset filenames from .output/public/assets/ so the
// <script> and <link> tags are always up-to-date after each build.
let _htmlShell = null;
function getHtmlShell() {
  if (_htmlShell) return _htmlShell;
  if (!existsSync(PUBLIC_DIR)) return null;
  try {
    const assetFiles = readdirSync(join(PUBLIC_DIR, 'assets'));
    const jsFile = assetFiles.find((f) => f.startsWith('index-') && f.endsWith('.js'));
    const cssFile = assetFiles.find((f) => f.startsWith('styles-') && f.endsWith('.css'));
    const jsTag = jsFile ? `<script type="module" src="/assets/${jsFile}"></script>` : '';
    const cssTag = cssFile ? `<link rel="stylesheet" href="/assets/${cssFile}" />` : '';
    _htmlShell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CampusSync</title>
    <link rel="icon" href="/favicon.ico" type="image/x-icon" />
    ${cssTag}
  </head>
  <body>
    <div id="root"></div>
    ${jsTag}
  </body>
</html>`;
    return _htmlShell;
  } catch (e) {
    console.warn('[CampusSync Backend] Could not build HTML shell:', e.message);
    return null;
  }
}

// Serve the React app shell on the root route (and SPA fallback below).
// Falls back to a plain-text health string when running in API-only mode.
function serveRoot(req, res) {
  const shell = getHtmlShell();
  if (shell) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(shell);
  } else {
    res.send('CampusSync Backend Server is Running!');
  }
}

app.get('/', serveRoot);


app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CampusSync Backend API',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET  /',
      'GET  /api/health',
      'POST /api/summarize',
      'POST /api/ats-check',
      'POST /api/ats',
      'POST /api/parse-document',
      'POST /api/extract-text',
      'GET  /api/teammates',
      'POST /api/teammates/invite',
    ],
  });
});

// ─── 2. AI Notes Summarizer (Gemini API with Fallback Chain) ─────────────────

const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
];

const SYSTEM_PROMPT = `You are an expert academic tutor and study assistant for university students.
Analyze the provided study notes, lecture text, textbook excerpt, or OCR document and generate an accurate, high-yield study summary.

You MUST format your response strictly in clean Markdown with exactly these four section headers:

📌 Quick Overview
(Provide a concise 2-3 sentence overview explaining what the material is about and its main academic objective.)

🔑 Key Concepts & Takeaways
(Provide a numbered step-by-step breakdown of the most critical concepts, principles, and mechanisms explained clearly.)

💡 Important Definitions / Formulas
(List definitions of key terms and mathematical/scientific formulas. Format each item on its own line as:
Name: Definition or formula body)

🧠 Revision Notes
(Provide concise bullet points for quick, last-minute exam revision and recall.)

Strict Rules:
- Base all information strictly on the provided content. Do not hallucinate or add unrelated topics.
- Do NOT output greeting, introductory filler, or concluding remarks.
- Only output the 4 sections above.`;

function cleanPrefix(line) {
  return line.replace(/^\s*(?:[-•*►▶→]|\d+[\.\)])\s*/, '').trim();
}

function parseSummaryResponse(rawText) {
  const text = rawText.replace(/\r\n/g, '\n').trim();

  // 1. Try JSON in case model wrapped output in JSON
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) || text.match(/^\{[\s\S]*\}$/);
    const candidate = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text;
    if (candidate.startsWith('{')) {
      const parsed = JSON.parse(candidate);
      if (parsed.overview || parsed.takeaways) {
        return {
          overview: parsed.overview || '',
          takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
          formulas: Array.isArray(parsed.formulas)
            ? parsed.formulas.map((f) => ({
                name: typeof f === 'string' ? f : f.name || 'Formula',
                body: typeof f === 'string' ? '' : f.body || f.formula || f.definition || '',
              }))
            : [],
          examPoints: Array.isArray(parsed.examPoints || parsed.revisionNotes)
            ? parsed.examPoints || parsed.revisionNotes
            : [],
          rawMarkdown: text,
        };
      }
    }
  } catch {}

  // 2. Parse structured Markdown sections
  const sectionHeaders = [
    { key: 'overview', regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:📌\s*)?Quick Overview(?:\*\*)?:?/i },
    { key: 'takeaways', regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:🔑\s*)?Key Concepts(?:\s*(?:&|and)\s*Takeaways)?(?:\*\*)?:?/i },
    { key: 'formulas', regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:💡\s*)?Important Definitions(?:\s*(?:\/|&|and)\s*Formulas)?(?:\*\*)?:?/i },
    { key: 'examPoints', regex: /(?:^|\n)(?:#+\s*)?(?:\*\*)?(?:🧠\s*)?(?:Revision Notes|Exam(?:\s*(?:\/|&|and)\s*)?Revision Summary)(?:\*\*)?:?/i },
  ];

  const matches = [];
  for (const sh of sectionHeaders) {
    const m = text.match(sh.regex);
    if (m && m.index !== undefined) {
      matches.push({ key: sh.key, index: m.index, matchLength: m[0].length });
    }
  }
  matches.sort((a, b) => a.index - b.index);

  const rawSections = {};
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const startIndex = current.index + current.matchLength;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
    rawSections[current.key] = text.slice(startIndex, endIndex).trim();
  }

  const overview = (rawSections['overview'] || '').replace(/^[-•*]\s*/, '').trim();
  const takeaways = (rawSections['takeaways'] || '')
    .split(/\n+/)
    .map(cleanPrefix)
    .filter((l) => l.length > 5);

  const formulas = [];
  (rawSections['formulas'] || '').split(/\n+/).forEach((line) => {
    const clean = cleanPrefix(line);
    if (!clean || clean.length < 3) return;

    const splitIdx = clean.indexOf(':');
    const splitEq = clean.indexOf('=');
    let splitPos = -1;
    if (splitIdx > 0 && splitEq > 0) splitPos = Math.min(splitIdx, splitEq);
    else if (splitIdx > 0) splitPos = splitIdx;
    else if (splitEq > 0) splitPos = splitEq;

    if (splitPos > 0 && splitPos < 45) {
      const name = clean.slice(0, splitPos).replace(/[*_]/g, '').trim();
      const body = clean.slice(splitPos + 1).replace(/^[:=]\s*/, '').replace(/^[*_]+|[*_]+$/g, '').trim();
      formulas.push({ name, body });
    } else {
      formulas.push({ name: 'Core Concept', body: clean.replace(/[*_]/g, '') });
    }
  });

  const examPoints = (rawSections['examPoints'] || '')
    .split(/\n+/)
    .map(cleanPrefix)
    .filter((l) => l.length > 5);

  if (!overview && !takeaways.length && !formulas.length && !examPoints.length) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      overview: paragraphs[0] || text.slice(0, 300),
      takeaways: paragraphs.slice(1, 6),
      formulas: [],
      examPoints: paragraphs.slice(6, 12),
      rawMarkdown: text,
    };
  }

  return { overview, takeaways, formulas, examPoints, rawMarkdown: text };
}

async function callGeminiWithTimeout(prompt, apiKey, modelName, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${SYSTEM_PROMPT}\n\n---\nDOCUMENT / STUDY NOTES CONTENT:\n${prompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens: 2500,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorJson = await response.json().catch(() => null);
      const apiError = errorJson?.error?.message || response.statusText;
      throw new Error(`[${modelName}] HTTP ${response.status}: ${apiError}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text || !text.trim()) {
      throw new Error(`[${modelName}] Empty content received from Gemini model`);
    }

    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

function chunkText(text, maxChunkSize = 35000) {
  if (text.length <= maxChunkSize) return [text];
  const chunks = [];
  const paragraphs = text.split(/\n{2,}/);
  let currentChunk = '';
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n\n' : '') + para;
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

async function runGeminiSummarizer(notes) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Server configuration error: GEMINI_API_KEY is not set in environment variables.');
  }

  const chunks = chunkText(notes);
  let fullPrompt = notes;

  if (chunks.length > 1) {
    console.log(`[CampusSync Backend] Document is large (${notes.length} chars). Processing ${chunks.length} chunks...`);
    const intermediateSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkPrompt = `Summarize the essential concepts, definitions, formulas, and revision points from this section (${i + 1} of ${chunks.length}):\n\n${chunks[i]}`;
      const { text: chunkResult } = await callGeminiWithFallbackChain(chunkPrompt, apiKey.trim());
      intermediateSummaries.push(`--- SECTION ${i + 1} SUMMARY ---\n${chunkResult}`);
    }
    fullPrompt = `Synthesize these extracted study sections into a single master study guide:\n\n${intermediateSummaries.join('\n\n')}`;
  }

  const { text: rawResponse } = await callGeminiWithFallbackChain(fullPrompt, apiKey.trim());
  return parseSummaryResponse(rawResponse);
}

async function callGeminiWithFallbackChain(prompt, apiKey) {
  const modelErrors = [];
  for (const model of FALLBACK_MODELS) {
    try {
      console.log(`[CampusSync Backend] Attempting Gemini request with model: ${model}...`);
      const text = await callGeminiWithTimeout(prompt, apiKey, model);
      console.log(`[CampusSync Backend] Successfully generated summary using model: ${model}`);
      return { text, modelUsed: model };
    } catch (err) {
      const isTimeout = err?.name === 'AbortError';
      const errorMsg = isTimeout ? 'Request timed out after 25s' : err?.message || String(err);
      console.warn(`[CampusSync Backend] Model "${model}" failed (${errorMsg}). Retrying next fallback model...`);
      modelErrors.push(`${model}: ${errorMsg}`);
    }
  }
  throw new Error(`All Gemini models in fallback chain failed.\nErrors:\n${modelErrors.join('\n')}`);
}

const handleSummarizeRequest = async (req, res) => {
  try {
    const notes = req.body?.notes || req.body?.text || req.body?.content;
    if (!notes || typeof notes !== 'string' || !notes.trim()) {
      return res.status(400).json({ error: 'No readable notes text provided.' });
    }

    const summary = await runGeminiSummarizer(notes.trim());
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[CampusSync Backend] Summarizer error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to generate summary' });
  }
};

app.post('/api/summarize', handleSummarizeRequest);
app.post('/api/summarizer', handleSummarizeRequest);

// ─── 3. ATS Resume Checker Endpoint ──────────────────────────────────────────

const TARGET_KEYWORDS = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Go', 'Rust', 'HTML', 'CSS', 'SQL',
  'React', 'Next.js', 'Node.js', 'Express', 'Vue', 'Angular', 'Django', 'FastAPI', 'Tailwind', 'Redux', 'Bootstrap',
  'PostgreSQL', 'MongoDB', 'MySQL', 'Redis', 'Firebase', 'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes',
  'Git', 'GitHub', 'CI/CD', 'REST APIs', 'GraphQL', 'System Design', 'Microservices', 'Agile/Scrum', 'Linux',
  'Unit Testing', 'Jest', 'Figma', 'UI/UX', 'Data Structures', 'Algorithms',
  'Problem Solving', 'Communication', 'Leadership', 'Teamwork', 'Collaboration',
];

const STANDARD_SECTIONS = [
  { name: 'Contact Information', keys: ['email', 'phone', 'mobile', 'linkedin', 'github', 'contact', '@'] },
  { name: 'Professional Summary', keys: ['summary', 'profile', 'objective', 'about me', 'about'] },
  { name: 'Work Experience / Internships', keys: ['experience', 'employment', 'internship', 'work history', 'history', 'position', 'work'] },
  { name: 'Projects', keys: ['project', 'projects', 'open source', 'portfolio', 'key projects'] },
  { name: 'Education', keys: ['education', 'academic', 'university', 'college', 'degree', 'b.tech', 'bachelor', 'master', 'gpa', 'cgpa'] },
  { name: 'Technical Skills', keys: ['skills', 'technologies', 'competencies', 'tools', 'stack', 'technical skills'] },
  { name: 'Certifications & Achievements', keys: ['certif', 'credentials', 'courses', 'achievements', 'awards', 'licenses'] },
];

const ACTION_VERBS = [
  'developed', 'built', 'designed', 'implemented', 'spearheaded', 'architected',
  'optimized', 'increased', 'decreased', 'reduced', 'led', 'created', 'automated',
  'integrated', 'engineered', 'scaled', 'improved', 'launched', 'refactored', 'managed',
];

function analyzeResumeText(text) {
  if (!text || text.trim().length === 0) {
    return {
      score: 0,
      wordCount: 0,
      extractedText: '',
      detectedKeywords: [],
      missingKeywords: TARGET_KEYWORDS.slice(0, 10),
      detectedSections: [],
      missingSections: STANDARD_SECTIONS.map((s) => s.name),
      strengths: [],
      recommendations: ['Upload a valid resume with readable text to view ATS scoring and feedback.'],
    };
  }

  const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lowerText = cleanText.toLowerCase();

  const detectedKeywords = [];
  const missingKeywords = [];

  TARGET_KEYWORDS.forEach((kw) => {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?:^|[\\s,;:.()/-])${escaped}(?:$|[\\s,;:.()/-])`, 'i');
    if (regex.test(cleanText) || lowerText.includes(kw.toLowerCase())) {
      detectedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  });

  const detectedSections = [];
  const missingSections = [];

  STANDARD_SECTIONS.forEach((sec) => {
    const found = sec.keys.some((k) => lowerText.includes(k));
    if (found) {
      detectedSections.push(sec.name);
    } else {
      missingSections.push(sec.name);
    }
  });

  const detectedVerbs = ACTION_VERBS.filter((verb) => {
    const regex = new RegExp(`\\b${verb}\\b`, 'i');
    return regex.test(lowerText);
  });

  const hasMetrics = /\b(?:\d+%\s*|\$\d+|\d+\+?\s*(?:users|clients|requests|ms|seconds|x|million|k))\b/i.test(cleanText);

  const keywordCoverage = detectedKeywords.length / Math.min(TARGET_KEYWORDS.length, 25);
  const keywordScore = Math.min(40, Math.round(keywordCoverage * 40));

  const sectionCoverage = detectedSections.length / STANDARD_SECTIONS.length;
  const sectionScore = Math.round(sectionCoverage * 30);

  let wordCountScore = 15;
  if (wordCount < 150) wordCountScore = 4;
  else if (wordCount < 300) wordCountScore = 9;
  else if (wordCount > 1200) wordCountScore = 10;

  let impactScore = 0;
  if (detectedVerbs.length >= 4) impactScore += 8;
  else if (detectedVerbs.length >= 2) impactScore += 4;
  if (hasMetrics) impactScore += 7;

  const totalScore = Math.min(100, Math.max(15, keywordScore + sectionScore + wordCountScore + impactScore));

  const strengths = [];
  const recommendations = [];

  if (detectedKeywords.length >= 8) {
    strengths.push(`Rich technical skills detected (${detectedKeywords.length} skills matched).`);
  } else {
    recommendations.push('Include more target technical skills and frameworks relevant to your target role.');
  }

  if (detectedSections.includes('Work Experience / Internships') || detectedSections.includes('Projects')) {
    strengths.push('Key portfolio sections (Experience / Projects) clearly identified.');
  }

  if (hasMetrics) {
    strengths.push('Strong quantification found (metrics, percentages, or scale numbers).');
  } else {
    recommendations.push('Add quantifiable metrics (e.g., "improved load time by 30%", "managed 500+ users").');
  }

  if (detectedVerbs.length >= 3) {
    strengths.push('Impact-driven phrasing with strong action verbs.');
  } else {
    recommendations.push('Start bullet points with strong action verbs like "Architected", "Engineered", "Optimized".');
  }

  if (missingSections.length > 0) {
    recommendations.push(`Add standard section headers: ${missingSections.slice(0, 3).join(', ')}.`);
  }

  return {
    score: totalScore,
    wordCount,
    extractedText: cleanText.slice(0, 1500) + (cleanText.length > 1500 ? '…' : ''),
    detectedKeywords,
    missingKeywords: missingKeywords.slice(0, 16),
    detectedSections,
    missingSections,
    strengths: strengths.length ? strengths : ['Basic resume structure present.'],
    recommendations: recommendations.length ? recommendations : ['Resume meets industry formatting guidelines.'],
  };
}

const handleAtsRequest = (req, res) => {
  try {
    const text = req.body?.text || req.body?.resumeText || req.body?.content;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'No resume text provided.' });
    }

    const result = analyzeResumeText(text.trim());
    return res.status(200).json(result);
  } catch (err) {
    console.error('[CampusSync Backend] ATS error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to analyze resume' });
  }
};

app.post('/api/ats-check', handleAtsRequest);
app.post('/api/ats', handleAtsRequest);
app.post('/api/ats/analyze', handleAtsRequest);

// ─── 4. Document Parsing / Text Extraction Endpoint ──────────────────────────

const handleParseDocument = (req, res) => {
  try {
    const { text, content, base64, fileName } = req.body || {};
    let extracted = '';

    if (text && typeof text === 'string') {
      extracted = text.trim();
    } else if (content && typeof content === 'string') {
      extracted = content.trim();
    } else if (base64 && typeof base64 === 'string') {
      const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
      extracted = Buffer.from(cleanBase64, 'base64').toString('utf-8').trim();
    }

    if (!extracted) {
      return res.status(400).json({ error: 'No readable document content or base64 provided.' });
    }

    return res.status(200).json({
      success: true,
      fileName: fileName || 'document.txt',
      text: extracted,
      wordCount: extracted.split(/\s+/).filter(Boolean).length,
      charCount: extracted.length,
    });
  } catch (err) {
    console.error('[CampusSync Backend] Parse document error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to extract text from document.' });
  }
};

app.post('/api/parse-document', handleParseDocument);
app.post('/api/extract-text', handleParseDocument);

// ─── 5. Teammates / Matcher Endpoint ─────────────────────────────────────────

const STUDENTS = [
  {
    id: 1,
    name: 'Aarav Sharma',
    branch: 'CS · 3rd Year',
    skills: ['React', 'Python'],
    lookingFor: 'Backend dev for hackathon.',
    initials: 'AS',
  },
  {
    id: 2,
    name: 'Priya Gupta',
    branch: 'IT · 2nd Year',
    skills: ['UI/UX', 'Figma'],
    lookingFor: 'Design projects with a shipping team.',
    initials: 'PG',
  },
  {
    id: 3,
    name: 'Rohan Iyer',
    branch: 'CS · 4th Year',
    skills: ['AI/ML', 'Python'],
    lookingFor: 'Teammate for a computer-vision hackathon.',
    initials: 'RI',
  },
  {
    id: 4,
    name: 'Sara Khan',
    branch: 'ECE · 3rd Year',
    skills: ['DevOps', 'SQL'],
    lookingFor: 'Frontend partner to ship an internal tool.',
    initials: 'SK',
  },
  {
    id: 5,
    name: 'Dev Patel',
    branch: 'IT · 2nd Year',
    skills: ['Web3', 'React'],
    lookingFor: 'Smart-contract mentor for an ETH build weekend.',
    initials: 'DP',
  },
  {
    id: 6,
    name: 'Ananya Rao',
    branch: 'CS · 4th Year',
    skills: ['SQL', 'Python', 'AI/ML'],
    lookingFor: 'Data analyst for a campus analytics project.',
    initials: 'AR',
  },
];

app.get('/api/teammates', (req, res) => {
  res.json({ success: true, count: STUDENTS.length, students: STUDENTS });
});

app.post('/api/teammates/invite', (req, res) => {
  const { studentId } = req.body || {};
  const student = STUDENTS.find((s) => s.id === Number(studentId));
  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }
  return res.json({ success: true, message: `Invite sent to ${student.name}!` });
});

// ─── 6. SPA Fallback & Error Handlers ─────────────────────────────────────────

// For any non-API GET request (e.g. /dashboard, /summarizer, /ats), serve the
// React app shell so client-side routing takes over in the browser.
// API routes and unknown POST/PUT/DELETE still return JSON errors.
app.use((req, res, next) => {
  const isApiRoute = req.path.startsWith('/api/');
  const isGetRequest = req.method === 'GET';
  if (!isApiRoute && isGetRequest) {
    const shell = getHtmlShell();
    if (shell) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(shell);
    }
  }
  // Unknown API endpoint or non-GET method → JSON 404
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl || req.url,
    availableEndpoints: [
      'GET  /',
      'GET  /api/health',
      'POST /api/summarize',
      'POST /api/ats-check',
      'POST /api/ats',
      'POST /api/parse-document',
      'POST /api/extract-text',
      'GET  /api/teammates',
      'POST /api/teammates/invite',
    ],
  });
});


app.use((err, req, res, next) => {
  console.error('[CampusSync Backend] Uncaught error:', err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

// Start listening if run directly
app.listen(PORT, () => {
  console.log(`[CampusSync Backend] Server started on port ${PORT}`);
});

export default app;
