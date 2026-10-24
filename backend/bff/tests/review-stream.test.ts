import { describe, expect, it, vi } from "vitest";
import { readReviewStream } from "../../../src/features/workbench/review-stream";
vi.mock("@/server/agents/coach-agent/review-pipeline", () => ({
  reviewPipeline: vi.fn(async (_body: unknown, options?: { onProgress: (event: unknown) => void }) => {
    options?.onProgress({ type: "evidence", evidence: { source: "review" } });
    return { ok: true, coachReply: "unchanged" };
  }),
  ReviewPipelineError: class extends Error {},
}));
import { POST } from "../../../app/api/coach/review/route";
describe("Review transport", () => {
 it("keeps direct Next NDJSON with dual Accept", async () => {
  const response = await POST(new Request("http://localhost:3000/api/coach/review", { method: "POST", headers: { Accept: "text/event-stream, application/x-ndjson", "Content-Type": "application/json" }, body: "{}" }));
  expect(response.headers.get("content-type")).toContain("application/x-ndjson");
  const onEvidence = vi.fn();const result = await readReviewStream(response,onEvidence);
  expect(result.coachReply).toBe("unchanged");expect(onEvidence).toHaveBeenCalledWith({ source: "review" });
 });
 it("decodes fragmented SSE and keeps Agent payload",async()=>{
  const raw='event: evidence\r\ndata: {"type":"evidence","evidence":{"source":"review"}}\r\n\r\nevent: complete\ndata: {"type":"complete","result":{"ok":true,"coachReply":"你好"}}\n\n';
  const bytes=new TextEncoder().encode(raw);const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{"Content-Type":"text/event-stream"}});
  const onEvidence=vi.fn();expect((await readReviewStream(response,onEvidence)).coachReply).toBe("你好");expect(onEvidence).toHaveBeenCalledOnce();
 });
 it("distinguishes BFF terminal from Agent error",async()=>{
  for(const [type,message] of [["error","agent failed"],["bff_error","The AI gateway is unavailable"]]){
   const response=new Response(`event: ${type}\ndata: ${JSON.stringify({type,error:message,requestId:"a".repeat(32)})}\n\n`,{headers:{"Content-Type":"text/event-stream"}});
   await expect(readReviewStream(response,vi.fn())).rejects.toThrow(message);
  }
 });
});
