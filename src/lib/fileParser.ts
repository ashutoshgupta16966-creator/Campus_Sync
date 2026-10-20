import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import mammoth from "mammoth";

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

export interface ExtractedImageItem {
  mimeType: string;
  data: string; // base64 string
  name: string;
}

/**
 * Checks whether a given file is a supported image format.
 */
export function isImageFile(file: File): boolean {
  const fileType = file.type || "";
  const fileName = file.name.toLowerCase();
  return (
    fileType.startsWith("image/") ||
    /\.(png|jpe?g|webp|bmp|gif)$/i.test(fileName)
  );
}

/**
 * Converts an image file to Base64 (stripping data URL prefix)
 * so it can be sent directly to Gemini's native multimodal Vision API.
 */
export function fileToBase64(file: File): Promise<ExtractedImageItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      const base64Data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        mimeType: file.type || "image/jpeg",
        data: base64Data,
        name: file.name,
      });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts plain text content from uploaded PDF, DOCX, or TXT documents.
 * Images are handled natively via direct Gemini Vision API, avoiding dead OCR errors.
 */
export async function extractTextFromFile(
  file: File,
  onProgress?: ParseProgressCallback
): Promise<string> {
  const fileType = file.type;
  const fileName = file.name.toLowerCase();

  // 1. Plain Text files
  if (fileName.endsWith(".txt") || fileType.includes("text/plain")) {
    onProgress?.(`Reading text file: ${file.name}…`);
    const text = await file.text();
    const cleanText = text.trim();
    console.log(`[CampusSync Parser] Read TXT file "${file.name}" (${cleanText.length} chars).`);
    return cleanText;
  }

  // 2. PDF files
  if (fileName.endsWith(".pdf") || fileType.includes("pdf")) {
    onProgress?.(`Opening PDF: ${file.name}…`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        useSystemFonts: true,
        disableFontFace: true,
      });

      const pdfDoc = await loadingTask.promise;
      let fullText = "";

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        onProgress?.(`Extracting PDF page ${i} of ${pdfDoc.numPages} (${file.name})…`);
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageStrings = textContent.items
          .map((item: any) => item.str || "")
          .filter(Boolean);

        const pageText = pageStrings.join(" ").trim();
        if (pageText.length > 0) {
          fullText += pageText + "\n\n";
        }
      }

      if (fullText.trim().length > 0) {
        console.log(`[CampusSync Parser] Parsed PDF "${file.name}" (${pdfDoc.numPages} pages, ${fullText.trim().length} chars).`);
        return fullText.trim();
      }

      throw new Error("No readable text found in PDF. If this is a scanned document, upload the image directly.");
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
    onProgress?.(`Reading Word document: ${file.name}…`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      if (result.value && result.value.trim().length > 0) {
        const text = result.value.trim();
        console.log(`[CampusSync Parser] Parsed DOCX "${file.name}" (${text.length} chars).`);
        return text;
      }
      throw new Error("Word document appears to be empty.");
    } catch (err: any) {
      console.error("DOCX parsing error:", err);
      throw new Error(err.message || "Failed to parse Word document.");
    }
  }

  // 4. Image files are processed directly via Gemini Vision
  if (isImageFile(file)) {
    return "";
  }

  throw new Error(`Unsupported file format: ${file.name}`);
}

/**
 * Processes multiple document files sequentially and concatenates extracted text.
 * Images are skipped here because they are sent directly to Gemini multimodal vision.
 */
export async function extractTextFromFiles(
  files: File[],
  onProgress?: ParseProgressCallback
): Promise<string> {
  const parts: string[] = [];
  const nonImageFiles = files.filter((f) => !isImageFile(f));

  let index = 0;
  for (const file of nonImageFiles) {
    index++;
    onProgress?.(`Processing document ${index} of ${nonImageFiles.length}: ${file.name}…`);
    try {
      const text = await extractTextFromFile(file, onProgress);
      if (text.trim().length > 0) {
        parts.push(`--- Notes from ${file.name} ---\n${text.trim()}`);
      }
    } catch (err: any) {
      console.warn(`[CampusSync Parser] Skipping ${file.name}:`, err.message);
      onProgress?.(`⚠️ Could not extract text from ${file.name}: ${err.message}`);
    }
  }

  return parts.join("\n\n");
}
