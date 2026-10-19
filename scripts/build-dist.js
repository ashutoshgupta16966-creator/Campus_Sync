import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const outputPublicDir = path.join(rootDir, '.output', 'public');
const distDir = path.join(rootDir, 'dist');

console.log('[build-dist] Preparing static production bundle for Render Static Site...');

if (!fs.existsSync(outputPublicDir)) {
  console.error(`[build-dist] ERROR: Expected .output/public directory not found at ${outputPublicDir}`);
  process.exit(1);
}

// 1. Ensure dist directory exists and clean it
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. Recursively copy all files from .output/public to dist
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(outputPublicDir, distDir);
console.log(`[build-dist] Copied static assets from .output/public -> dist`);

// 3. Scan dist/assets for compiled bundle files
const assetsDir = path.join(distDir, 'assets');
let jsEntryFile = null;
let cssFiles = [];
let preloadFiles = [];

if (fs.existsSync(assetsDir)) {
  const assetFiles = fs.readdirSync(assetsDir);
  
  // Find the primary entry script (e.g. index-BVkCq81g.js)
  jsEntryFile = assetFiles.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  
  // Find CSS stylesheets
  cssFiles = assetFiles.filter((f) => f.endsWith('.css'));
  
  // Find secondary route/chunk files to modulepreload
  preloadFiles = assetFiles.filter((f) => f.startsWith('routes-') && f.endsWith('.js'));
}

if (!jsEntryFile) {
  console.warn('[build-dist] Warning: Could not locate index-*.js in assets directory.');
}

const cssTags = cssFiles
  .map((css) => `    <link rel="stylesheet" href="/assets/${css}" />`)
  .join('\n');

const preloadTags = preloadFiles
  .map((chunk) => `    <link rel="modulepreload" href="/assets/${chunk}" />`)
  .join('\n');

const jsTag = jsEntryFile
  ? `    <script type="module" src="/assets/${jsEntryFile}"></script>`
  : '';

// 4. Generate dist/index.html
const indexHtmlContent = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CampusSync — AI Study, Teammate &amp; Resume Toolkit</title>
    <meta
      name="description"
      content="CampusSync turns lecture notes into exam-ready summaries, matches you with hackathon teammates, and scores your resume against ATS filters."
    />
    <link rel="icon" href="/favicon.ico" type="image/x-icon" />
${cssTags}
${preloadTags}
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
</html>
`;

fs.writeFileSync(path.join(distDir, 'index.html'), indexHtmlContent, 'utf-8');
console.log(`[build-dist] Successfully generated dist/index.html with script: ${jsEntryFile}`);

// 5. Generate Render Static Site rewrite rule (_redirects) for SPA routing
// This ensures direct navigation/refresh to /dashboard, /summarizer, etc. returns index.html (200 OK)
const redirectsContent = `/*    /index.html   200\n`;
fs.writeFileSync(path.join(distDir, '_redirects'), redirectsContent, 'utf-8');
console.log(`[build-dist] Generated dist/_redirects for Render SPA routing`);

// Also create 200.html and 404.html fallbacks
fs.copyFileSync(path.join(distDir, 'index.html'), path.join(distDir, '200.html'));
fs.copyFileSync(path.join(distDir, 'index.html'), path.join(distDir, '404.html'));

console.log('[build-dist] Build completed successfully. Contents of dist/:');
const distEntries = fs.readdirSync(distDir);
console.log(distEntries.join(', '));
