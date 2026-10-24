import { describe, expect, it } from "vitest";
import { bffErrorMessage } from "@/features/workbench/bff-errors";
describe("BFF provenance", () => {
 it("keeps Agent messages on their existing path", () => expect(bffErrorMessage({ok:false,error:"agent",status:503})).toBeNull());
 it.each(["AI_BUSY","RATE_LIMITED","TIMEOUT","REDIS_UNAVAILABLE"])("renders %s with correlation", (code) => {
  const message=bffErrorMessage({source:"bff",code,requestId:"a".repeat(32)});
  expect(message).toContain("Request-ID:"); expect(message).not.toContain("learner");
 });
 it("never displays arbitrary upstream text or invalid IDs", () => expect(bffErrorMessage({type:"bff_error",error:"secret",requestId:"secret"})).not.toContain("secret"));
});
