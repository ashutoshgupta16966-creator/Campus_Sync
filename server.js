import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';

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
    <script>
      window.$_TSR = {
        buffer: [],
        router: {
          matches: [],
          manifest: { routes: {} },
        },
        h() { this.hydrated = true; },
        e() { this.streamEnded = true; },
        c() {},
        p(fn) { fn(); },
      };
    </script>
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

// ─── 2. AI Notes Summarizer (Claude + Gemini Multi-Model Fallback Chain with Continuation) ───

// Multi-tier model fallback chain in strict priority order
const FALLBACK_CHAIN = [
  { provider: 'anthropic', model: 'claude-opus-4.8' },
  { provider: 'anthropic', model: 'claude-sonnet-4.6' },
  { provider: 'gemini', model: 'gemini-3.8-flash' },
  { provider: 'gemini', model: 'gemini-3.7-flash' },
  { provider: 'gemini', model: 'gemini-3.6-flash' },
];

const HARDCODED_FALLBACK = {
  keyConcepts: [],
  importantPoints: [],
  keywords: [],
  unreadableMessage: 'I could not find clear readable notes in this image.',
  rawMarkdown: 'I could not find clear readable notes in this image.',
  overview: 'I could not find clear readable notes in this image.',
  takeaways: [],
  formulas: [],
  examPoints: [],
};

const EXACT_SYSTEM_PROMPT = `You are a strict note-organizing assistant. You will be given study notes (handwritten or printed images, or document text).
Your ONLY job is to extract and organize the actual content visible in the notes:
- Summarise only what is actually written in the notes.
- Do not invent facts, formulas, explanations, or topics that are not in the notes.
- If part of the image is unclear, blurry, or unreadable, say so briefly instead of guessing.
- Keep the notes' original language, terminology, and structure (headings, bullet points).
- Format your response in this structure exactly:

## Key Concepts / Topics
(list the main topics/headings exactly as found in the notes)

## Important Points
(organize the actual written content into clear bullet points, staying as close to the original wording as possible)

## Keywords / Terms
(list key terms or words that appear in the notes)

If the image or input does not contain readable study notes, respond only with: 'I could not find clear readable notes in this image.'`;

function getAnthropicApiKey() {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim()) {
    return envKey.trim();
  }
  return null;
}

function getGeminiApiKey() {
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim()) {
    return envKey.trim();
  }
  return null;
}

function extractSuggestedModel(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') return null;
  const match = errorMessage.match(/(?:use|suggested|try|recommend(?:ed)?)\s+[`"']?([a-zA-Z0-9.-]+)[`"']?/i);
  return match ? match[1] : null;
}

function joinContinuationText(existingText, incomingText) {
  if (!existingText) return (incomingText || '').trim();
  if (!incomingText) return existingText.trim();

  let trimmedIncoming = incomingText.trimStart();
  const trimmedExisting = existingText.trimEnd();

  const incomingHadLeadingNewline = /^[\r\n]/.test(incomingText);
  const existingHadTrailingNewline = /[\r\n]$/.test(existingText);

  // 1. Check if the next model repeated the last word (or last partial word)
  const existingWords = trimmedExisting.split(/\s+/);
  const lastWord = existingWords[existingWords.length - 1];

  if (lastWord && lastWord.length >= 2) {
    const escapedWord = lastWord.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    // Case 1A: Exact whole-word repetition (e.g. "computer" followed by "computer science")
    const wholeWordRegex = new RegExp(`^${escapedWord}\\b`, 'i');
    if (wholeWordRegex.test(trimmedIncoming)) {
      trimmedIncoming = trimmedIncoming.replace(wholeWordRegex, '').trimStart();
      return `${trimmedExisting} ${trimmedIncoming}`;
    }

    // Case 1B: Prefix repetition (e.g. "compu" followed by "computer science")
    const prefixRegex = new RegExp(`^${escapedWord}`, 'i');
    if (prefixRegex.test(trimmedIncoming)) {
      const suffixAndRest = trimmedIncoming.slice(lastWord.length);
      return `${trimmedExisting}${suffixAndRest}`;
    }
  }

  // 2. Check if boundary contains newlines or starts with a markdown header/bullet
  const incomingIsMarkdownHeaderOrBullet = /^#{1,6}\s|^[-*•►▶→\d]/.test(trimmedIncoming);
  if (incomingHadLeadingNewline || existingHadTrailingNewline || incomingIsMarkdownHeaderOrBullet) {
    return `${trimmedExisting}\n\n${trimmedIncoming}`;
  }

  // 3. If incoming starts with punctuation (e.g. "." or ","), attach without space
  if (/^[.,!?;:)]/.test(trimmedIncoming)) {
    return `${trimmedExisting}${trimmedIncoming}`;
  }

  // 4. Default clean join: always ensure single space between consecutive words
  return `${trimmedExisting} ${trimmedIncoming}`;
}

function normalizeAndValidateImages(images) {
  if (!Array.isArray(images) || images.length === 0) return [];
  const valid = [];
  for (const img of images) {
    if (!img || !img.data) continue;
    let mimeType = (img.mimeType || 'image/jpeg').toLowerCase();
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    const cleanData = img.data.replace(/^data:[^;]+;base64,/, '').trim();
    if (!cleanData) continue;
    valid.push({
      mimeType,
      data: cleanData,
    });
  }
  return valid;
}

function formatAnthropicContent(content, partialText) {
  const userBlocks = [];

  if (Array.isArray(content.images) && content.images.length > 0) {
    for (const img of content.images) {
      if (img.data) {
        userBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mimeType || 'image/jpeg',
            data: img.data,
          },
        });
      }
    }
  }

  let textPrompt = '';
  if (content.text && content.text.trim()) {
    textPrompt += `STUDY NOTES / DOCUMENT CONTENT:\n${content.text.trim()}\n\n`;
  }

  if (partialText && partialText.trim()) {
    textPrompt += `Here is the summary written so far:\n"""\n${partialText.trim()}\n"""\n\nContinue exactly from where it stopped. Do not repeat anything already written. If the text stopped in the middle of a word or sentence, finish that sentence first before continuing. Do not repeat the beginning of the sentence. Do not restart, do not apologise, do not mention any error or model change. Keep the same format and style.`;
  } else {
    textPrompt += `Please extract and organize the study notes according to the system instructions.`;
  }

  userBlocks.push({
    type: 'text',
    text: textPrompt,
  });

  return userBlocks;
}

function formatGeminiContent(content, partialText) {
  const parts = [];

  let textPrompt = '';
  if (content.text && content.text.trim()) {
    textPrompt += `STUDY NOTES / DOCUMENT CONTENT:\n${content.text.trim()}\n\n`;
  }

  if (partialText && partialText.trim()) {
    textPrompt += `Here is the summary written so far:\n"""\n${partialText.trim()}\n"""\n\nContinue exactly from where it stopped. Do not repeat anything already written. If the text stopped in the middle of a word or sentence, finish that sentence first before continuing. Do not repeat the beginning of the sentence. Do not restart, do not apologise, do not mention any error or model change. Keep the same format and style.`;
  } else {
    textPrompt += `Please extract and organize the study notes according to the system instructions.`;
  }

  parts.push({ text: textPrompt });

  if (Array.isArray(content.images) && content.images.length > 0) {
    for (const img of content.images) {
      if (img.data) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType || 'image/jpeg',
            data: img.data,
          },
        });
      }
    }
  }

  return parts;
}

function parseSummaryResponse(rawText) {
  const text = (rawText || '').replace(/\r\n/g, '\n').trim();

  // 1. Check for unreadable notes condition
  if (
    /could not find clear readable notes in this image/i.test(text) ||
    !text
  ) {
    const msg = 'I could not find clear readable notes in this image.';
    return {
      keyConcepts: [],
      importantPoints: [],
      keywords: [],
      unreadableMessage: msg,
      rawMarkdown: text || msg,
      overview: msg,
      takeaways: [],
      formulas: [],
      examPoints: [],
    };
  }

  // 2. Parse structured Markdown sections using reliable index offsets
  const headers = [
    { key: 'keyConcepts', regex: /(?:^|\n)##\s*Key Concepts\s*(?:\/|&|and)?\s*Topics\s*:?/i },
    { key: 'importantPoints', regex: /(?:^|\n)##\s*Important Points\s*:?/i },
    { key: 'keywords', regex: /(?:^|\n)##\s*Keywords\s*(?:\/|&|and)?\s*Terms\s*:?/i },
  ];

  const matches = [];
  for (const h of headers) {
    const m = text.match(h.regex);
    if (m && m.index !== undefined) {
      matches.push({ key: h.key, index: m.index, matchLength: m[0].length });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const rawSections = {};
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current) continue;
    const next = matches[i + 1];
    const startIndex = current.index + current.matchLength;
    const endIndex = next ? next.index : text.length;
    rawSections[current.key] = text.slice(startIndex, endIndex).trim();
  }

  function extractItems(block) {
    if (!block) return [];
    return block
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-*•►▶→]|\d+[\.\)])\s*/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('(') && !line.startsWith('#'));
  }

  function extractKeywords(block) {
    if (!block) return [];
    const lines = extractItems(block);
    const keywords = [];
    for (const line of lines) {
      const parts = line
        .split(/[,;]+/)
        .map((k) => k.replace(/[*_`]/g, '').trim())
        .filter(Boolean);
      keywords.push(...parts);
    }
    return keywords;
  }

  const keyConcepts = extractItems(rawSections['keyConcepts']);
  const importantPoints = extractItems(rawSections['importantPoints']);
  const keywords = extractKeywords(rawSections['keywords']);

  if (keyConcepts.length === 0 && importantPoints.length === 0 && keywords.length === 0) {
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return {
      keyConcepts: paragraphs.slice(0, 1),
      importantPoints: paragraphs.slice(1, 6),
      keywords: [],
      rawMarkdown: text,
      overview: paragraphs[0] || '',
      takeaways: paragraphs.slice(1, 6),
      formulas: [],
      examPoints: paragraphs.slice(1, 6),
    };
  }

  return {
    keyConcepts,
    importantPoints,
    keywords,
    rawMarkdown: text,
    overview: keyConcepts.join(' · ') || importantPoints[0] || '',
    takeaways: importantPoints,
    formulas: [],
    examPoints: importantPoints,
  };
}

/**
 * Streams a single model with a 35s hard timeout and 15s chunk-stall watchdog.
 * Collects text chunks and invokes onChunk callback as chunks arrive.
 */
async function streamSingleModel({
  provider,
  modelName,
  content,
  partialText,
  effectiveSystemPrompt,
  anthropicApiKey,
  geminiApiKey,
  onChunk,
}) {
  const OVERALL_TIMEOUT_MS = 35000; // 35 seconds
  const STALL_TIMEOUT_MS = 15000;   // 15 seconds

  const controller = new AbortController();
  let timedOut = false;
  let stalled = false;

  const overallTimer = setTimeout(() => {
    timedOut = true;
    controller.abort('timeout (35s)');
  }, OVERALL_TIMEOUT_MS);

  let stallTimer = null;
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort('stalled (no chunk for 15s)');
    }, STALL_TIMEOUT_MS);
  };

  resetStallTimer();

  try {
    let accumulatedText = '';

    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: anthropicApiKey });
      const userContent = formatAnthropicContent(content, partialText);

      const stream = client.messages.stream(
        {
          model: modelName,
          max_tokens: 3500,
          system: effectiveSystemPrompt,
          messages: [
            {
              role: 'user',
              content: userContent,
            },
          ],
        },
        { signal: controller.signal }
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text;
          if (text) {
            resetStallTimer();
            accumulatedText += text;
            onChunk(text);
          }
        }
      }
    } else if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: effectiveSystemPrompt,
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          maxOutputTokens: 3500,
        },
      });

      const parts = formatGeminiContent(content, partialText);
      const result = await model.generateContentStream(
        {
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
        },
        { signal: controller.signal }
      );

      for await (const chunk of result.stream) {
        let text = '';
        try {
          text = chunk.text();
        } catch {}
        if (text) {
          resetStallTimer();
          accumulatedText += text;
          onChunk(text);
        }
      }
    }

    if (!accumulatedText || !accumulatedText.trim()) {
      return {
        success: false,
        text: '',
        result: 'empty answer',
        error: new Error('Empty response received from model stream'),
        suggestedModel: null,
      };
    }

    return {
      success: true,
      text: accumulatedText,
      result: 'success',
      suggestedModel: null,
    };
  } catch (err) {
    let resultType = 'error';
    if (timedOut) {
      resultType = 'timeout (35s)';
    } else if (stalled) {
      resultType = 'stalled (no chunk for 15s)';
    } else if (err?.name === 'AbortError') {
      resultType = 'aborted';
    } else if (err?.status) {
      resultType = `HTTP ${err.status}`;
    } else {
      resultType = err?.message || String(err);
    }

    const suggestedModel = extractSuggestedModel(err?.message);

    return {
      success: false,
      text: '',
      result: resultType,
      error: err,
      suggestedModel,
    };
  } finally {
    clearTimeout(overallTimer);
    if (stallTimer) clearTimeout(stallTimer);
  }
}

/**
 * Executes the multi-tier fallback chain with streaming and partial-answer continuation.
 * Follows tiers: Claude Opus 4.8 -> Claude Sonnet 4.6 -> Gemini 3.8 Flash -> 3.7 -> 3.6.
 * Logs backend telemetry only; user never sees model switching.
 */
async function callMultiModelWithContinuation(content) {
  const requestStartTime = Date.now();
  const anthropicKey = getAnthropicApiKey();
  const geminiKey = getGeminiApiKey();

  let partialText = '';
  let finalStatus = 'all_failed';
  let tiersAttempted = 0;

  const languageInstruction = content.language
    ? `\n\nCRITICAL LANGUAGE REQUIREMENT: All headings, explanations, bullet points, and extracted terms must be written strictly in ${content.language}.`
    : '';
  const effectiveSystemPrompt = `${EXACT_SYSTEM_PROMPT}${languageInstruction}`;

  for (let i = 0; i < FALLBACK_CHAIN.length; i++) {
    const tier = FALLBACK_CHAIN[i];
    const tierNumber = i + 1;
    const { provider, model } = tier;

    // Check provider API key availability
    if (provider === 'anthropic' && !anthropicKey) {
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Skipped silently (ANTHROPIC_API_KEY not configured).`);
      continue;
    }
    if (provider === 'gemini' && !geminiKey) {
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Skipped silently (GEMINI_API_KEY not configured).`);
      continue;
    }

    tiersAttempted++;
    const tierStartTime = Date.now();
    const isContinuation = Boolean(partialText && partialText.trim().length > 0);

    console.log(
      `[CampusSync Backend] [Tier ${tierNumber}: ${model}] START at ${new Date(tierStartTime).toISOString()} | Continuation: ${isContinuation} | Chars collected so far: ${partialText.length}`
    );

    let tierAccumulatedText = '';
    const res = await streamSingleModel({
      provider,
      modelName: model,
      content,
      partialText,
      effectiveSystemPrompt,
      anthropicApiKey: anthropicKey,
      geminiApiKey: geminiKey,
      onChunk: (chunk) => {
        tierAccumulatedText += chunk;
      },
    });

    const tierEndTime = Date.now();
    const elapsedMs = tierEndTime - tierStartTime;

    if (res.success && res.text) {
      partialText = isContinuation
        ? joinContinuationText(partialText, res.text)
        : res.text;

      console.log(
        `[CampusSync Backend] [Tier ${tierNumber}: ${model}] END at ${new Date(tierEndTime).toISOString()} | Elapsed: ${elapsedMs}ms | Result: success | Total chars: ${partialText.length}`
      );
      finalStatus = 'success';
      break;
    }

    // Tier failed (timeout, stalled, error, or empty answer)
    console.warn(
      `[CampusSync Backend] [Tier ${tierNumber}: ${model}] END at ${new Date(tierEndTime).toISOString()} | Elapsed: ${elapsedMs}ms | Result: ${res.result} | Chars in tier: ${tierAccumulatedText.length} | Details: ${res.error?.message || res.result}`
    );

    // If text chunks arrived before the failure, preserve them in partialText
    if (tierAccumulatedText.trim().length > 0) {
      partialText = isContinuation
        ? joinContinuationText(partialText, tierAccumulatedText)
        : tierAccumulatedText;
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Preserved ${tierAccumulatedText.length} partial characters for next tier continuation.`);
    }

    // Check if error suggests a replacement model name
    if (res.suggestedModel) {
      console.log(`[CampusSync Backend] [Tier ${tierNumber}: ${model}] Model suggested replacement: ${res.suggestedModel}. Attempting suggested model...`);
      const sugStartTime = Date.now();
      let sugAccumulated = '';
      const sugRes = await streamSingleModel({
        provider,
        modelName: res.suggestedModel,
        content,
        partialText,
        effectiveSystemPrompt,
        anthropicApiKey: anthropicKey,
        geminiApiKey: geminiKey,
        onChunk: (chunk) => {
          sugAccumulated += chunk;
        },
      });
      const sugElapsedMs = Date.now() - sugStartTime;
      if (sugRes.success && sugRes.text) {
        partialText = isContinuation
          ? joinContinuationText(partialText, sugRes.text)
          : sugRes.text;
        console.log(`[CampusSync Backend] [Suggested: ${res.suggestedModel}] SUCCESS in ${sugElapsedMs}ms | Total chars: ${partialText.length}`);
        finalStatus = 'success';
        break;
      }
      if (sugAccumulated.trim().length > 0) {
        partialText = joinContinuationText(partialText, sugAccumulated);
      }
    }
  }

  const totalElapsedMs = Date.now() - requestStartTime;
  console.log(
    `[CampusSync Backend] Total request time: ${totalElapsedMs}ms across ${tiersAttempted} tiers attempted. Final status: ${finalStatus} | Total characters: ${partialText.length}`
  );

  return {
    text: partialText || null,
    allFailed: finalStatus !== 'success' && !partialText,
  };
}

async function runSummarizerChain(input) {
  let notes = '';
  const images = [];
  const language = input?.language || input?.lang;

  if (typeof input === 'string') {
    notes = input.trim();
  } else if (input && typeof input === 'object') {
    notes = (input.notes || input.text || input.content || '').trim();
    if (Array.isArray(input.images)) {
      images.push(...normalizeAndValidateImages(input.images));
    }
    if (input.image) {
      if (typeof input.image === 'string') {
        const match = input.image.match(/^data:([^;]+);base64,(.+)$/);
        images.push({
          mimeType: match ? match[1] : 'image/jpeg',
          data: match ? match[2] : input.image,
        });
      } else if (typeof input.image === 'object' && input.image.data) {
        images.push({
          mimeType: input.image.mimeType || 'image/jpeg',
          data: input.image.data.replace(/^data:[^;]+;base64,/, ''),
        });
      }
    }
  }

  if (!notes && images.length === 0) {
    throw new Error('No readable notes or image provided. Please upload notes or paste text.');
  }

  const { text: finalText, allFailed } = await callMultiModelWithContinuation({
    text: notes,
    images,
    language,
  });

  if (allFailed || !finalText) {
    return { ...HARDCODED_FALLBACK };
  }

  return parseSummaryResponse(finalText);
}

const handleSummarizeRequest = async (req, res) => {
  try {
    const body = req.body || {};
    const notes = body.notes || body.text || body.content;
    const images = body.images;
    const image = body.image;
    const language = body.language || body.lang || body.targetLanguage;

    if ((!notes || typeof notes !== 'string' || !notes.trim()) && !images && !image) {
      return res.status(400).json({ error: 'No readable notes or image provided.' });
    }

    const summary = await runSummarizerChain({ notes, images, image, language });
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[CampusSync Backend] Summarizer unexpected error:', err.message);
    if (err.message && err.message.includes('No readable notes')) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(200).json(HARDCODED_FALLBACK);
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
