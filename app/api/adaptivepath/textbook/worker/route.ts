import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

// Self-host the worker from the same pinned PDF.js package as the reader.
export async function GET() {
  const worker = await readFile(join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
  return new Response(worker, { headers: {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  } });
}
