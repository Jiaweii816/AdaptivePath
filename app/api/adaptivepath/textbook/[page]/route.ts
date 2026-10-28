import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ page: string }> }) {
  const { page } = await context.params;
  // Only the twelve known pages are addressable; never accept a filesystem path.
  if (!/^(?:[1-9]|1[0-2])$/.test(page)) return new Response("Page not found", { status: 404 });
  try {
    const image = await readFile(join(process.cwd(), "src/features/adaptivepath/data/biology-12-2/assets/pages", `page-${page.padStart(2, "0")}.png`));
    return new Response(image, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Textbook page unavailable", { status: 404 });
  }
}
