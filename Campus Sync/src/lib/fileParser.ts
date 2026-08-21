import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import mammoth from "mammoth";
import { createWorker } from "tesseract.js";

// Configure PDF.js worker
if (typeof window !== "undefined" && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export type ParseProgressCallback = (status: string) => void;

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
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;
      let fullText = "";

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        onProgress?.(`Extracting text from page ${i} of ${pdfDoc.numPages}…`);
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageStrings = textContent.items.map((item: any) => item.str || "");
        fullText += pageStrings.join(" ") + "\n";
      }

      if (fullText.trim().length > 0) {
        return fullText.trim();
      }
      onProgress?.("No direct text layer found in PDF. Attempting OCR…");
    } catch (err) {
      console.warn("PDF.js parsing failed, trying raw text fallback", err);
    }
  }

  // 3. DOCX / DOC files
  if (fileName.endsWith(".docx") || fileName.endsWith(".doc") || fileType.includes("wordprocessingml") || fileType.includes("msword")) {
    onProgress?.("Reading Word document structure…");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      if (result.value && result.value.trim().length > 0) {
        return result.value.trim();
      }
    } catch (err) {
      console.warn("Mammoth DOCX parsing failed, attempting raw text extraction", err);
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
    } catch (err) {
      console.error("Tesseract OCR failed", err);
      throw new Error("Unable to perform OCR on image. Please make sure the image is clear.");
    }
  }

  // 5. Fallback for arrayBuffer string scanning
  try {
    onProgress?.("Scanning document binary encoding…");
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    const raw = decoder.decode(buffer);
    // Extract printable text sequences
    const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ");
    if (printable.trim().length > 20) {
      return printable.trim();
    }
  } catch (err) {
    console.warn("Fallback text decoding failed", err);
  }

  throw new Error(`Unsupported file type or empty file content: ${file.name}`);
}
