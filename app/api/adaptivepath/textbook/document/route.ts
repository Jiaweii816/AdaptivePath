import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const pdf = await readFile(join(process.cwd(), "src/features/adaptivepath/data/biology-12-2/assets/Biology_2e_Section_12_2.pdf"));
    return new Response(pdf, { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Biology_2e_Section_12_2.pdf"',
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Textbook PDF unavailable", { status: 404 });
  }
}
