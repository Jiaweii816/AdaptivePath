import { describe, expect, it } from "vitest";
import { getProcessInstanceId } from "@/server/observability/process-instance";

describe("trace process instance identity", () => {
  it("is stable for the lifetime of the process", () => {
    const first = getProcessInstanceId();
    expect(getProcessInstanceId()).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
