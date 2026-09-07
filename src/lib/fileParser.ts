import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import mammoth from "mammoth";
import { createWorker } from "tesseract.js";

// Configure PDF.js worker reliably
if (typeof window !== "undefined") {
  try {
    if (pdfjsWorker) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    }
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
}

export type ParseProgressCallback = (status: string) => void;

/**
 * Renders a PDF page onto an HTML Canvas and runs Tesseract OCR.
 * Used as a fallback for scanned image-based PDF pages.
 */
async function ocrPdfPage(page: any): Promise<string> {
  try {
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return "";

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport }).promise;

    const worker = await createWorker("eng");
    const ret = await worker.recognize(canvas);
    await worker.terminate();
    return ret.data.text || "";
  } catch (err) {
    console.warn("OCR on PDF page failed:", err);
    return "";
  }
}

/**
 * Extracts plain text content from uploaded PDF, DOCX, TXT, or Image files.
 */
export async function extractTextFromFile(
  file: File,
  onProgress?: ParseProgressCallback
): Promise<string> {
  const fileType = file.type;
  const fileName = file.name.toLowerCase();

  // 1. Plain Text files
  if (fileName.endsWith(".txt") || fileType.includes("text/plain")) {
    onProgress?.("Reading text file…");
    const text = await file.text();
    return text.trim();
  }

  // 2. PDF files
  if (fileName.endsWith(".pdf") || fileType.includes("pdf")) {
    onProgress?.("Extracting text from PDF pages…");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useSystemFonts: true,
        disableFontFace: true,
      });
      
      const pdfDoc = await loadingTask.promise;
      let fullText = "";
      let scannedPagesCount = 0;

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        onProgress?.(`Extracting text from PDF page ${i} of ${pdfDoc.numPages}…`);
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageStrings = textContent.items
          .map((item: any) => item.str || "")
          .filter(Boolean);

        const pageText = pageStrings.join(" ").trim();
        
        if (pageText.length > 10) {
          fullText += pageText + "\n\n";
        } else {
          // Page has no direct text layer; attempt Canvas OCR for scanned PDF page
          scannedPagesCount++;
          onProgress?.(`Running OCR on scanned PDF page ${i} of ${pdfDoc.numPages}…`);
          const ocrText = await ocrPdfPage(page);
          if (ocrText.trim().length > 0) {
            fullText += ocrText.trim() + "\n\n";
          }
        }
      }

      if (fullText.trim().length > 0) {
        return fullText.trim();
      }

      throw new Error("No readable text could be found or extracted from the PDF file.");
    } catch (err: any) {
      console.error("PDF text extraction error:", err);
      throw new Error(err.message || "Failed to parse PDF document text.");
    }
  }

  // 3. DOCX / DOC files
  if (
    fileName.endsWith(".docx") ||
    fileName.endsWith(".doc") ||
    fileType.includes("wordprocessingml") ||
    fileType.includes("msword")
  ) {
    onProgress?.("Reading Word document structure…");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      if (result.value && result.value.trim().length > 0) {
        return result.value.trim();
      }
      throw new Error("Word document appears to be empty.");
    } catch (err: any) {
      console.error("DOCX parsing error:", err);
      throw new Error(err.message || "Failed to parse Word document.");
    }
  }

  // 4. Image files (PNG, JPG, JPEG, WEBP)
  if (
    fileType.startsWith("image/") ||
    /\.(png|jpe?g|webp|bmp|gif)$/i.test(fileName)
  ) {
    onProgress?.("Initializing OCR engine (Tesseract.js)…");
    try {
      const worker = await createWorker("eng");
      onProgress?.("Analyzing image text with OCR…");
      const ret = await worker.recognize(file);
      await worker.terminate();
      const text = ret.data.text || "";
      if (text.trim().length > 0) {
        return text.trim();
      }
      throw new Error("No text detected in the uploaded image.");
    } catch (err: any) {
      console.error("Tesseract OCR failed:", err);
      throw new Error(err.message || "Unable to perform OCR on image. Ensure image is clear.");
    }
  }

  throw new Error(`Unsupported file format or unreadable file: ${file.name}`);
}

/**
 * Processes multiple files sequentially and concatenates extracted text.
 * Reports per-file progress via onProgress.
 */
export async function extractTextFromFiles(
  files: File[],
  onProgress?: ParseProgressCallback
): Promise<string> {
  const parts: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(`Processing file ${i + 1} of ${files.length}: ${file.name}…`);
    try {
      const text = await extractTextFromFile(file, onProgress);
      if (text.trim().length > 0) {
        parts.push(`--- ${file.name} ---\n${text.trim()}`);
      }
    } catch (err: any) {
      console.warn(`Skipping ${file.name}:`, err.message);
      onProgress?.(`⚠️ Could not extract text from ${file.name}, skipping…`);
    }
  }

  if (parts.length === 0) {
    throw new Error("No readable text could be extracted from any of the uploaded files.");
  }

  return parts.join("\n\n");
}
