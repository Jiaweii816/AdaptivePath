import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../../proxy";
afterEach(() => vi.unstubAllEnvs());
const request = (host: string, token?: string) => new NextRequest("http://next:3000/api/coach/chat", { headers: { host, ...(token ? { "x-coach-internal-token": token } : {}) } });
describe("proxy trust", () => {
 it("fails closed without a configured secret", () => {vi.stubEnv("BFF_PROXY_ENABLED","true");vi.stubEnv("BFF_INTERNAL_TOKEN","");expect(proxy(request("next:3000")).status).toBe(403);});
 it("checks token and Host separately", () => {vi.stubEnv("BFF_PROXY_ENABLED","true");vi.stubEnv("BFF_INTERNAL_TOKEN","test-secret");expect(proxy(request("next:3000","wrong")).status).toBe(403);expect(proxy(request("next:3001","test-secret")).status).toBe(421);expect(proxy(request("evil:3000","test-secret")).status).toBe(421);expect(proxy(request("next:3000","test-secret")).status).toBe(200);});
 it("preserves local port enforcement including IPv6", () => {vi.stubEnv("BFF_PROXY_ENABLED","false");for(const host of ["localhost:3000","[::1]:3000"])expect(proxy(request(host)).status).toBe(200);for(const host of ["localhost","localhost:3001"])expect(proxy(request(host)).status).toBe(421);});
 it("logs only BFF routes and rejections in local mode, every request when deployed", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const page = (host: string) => new NextRequest("http://next:3000/workbench", { headers: { host } });
  vi.stubEnv("BFF_PROXY_ENABLED", "false");
  proxy(page("localhost:3000"));
  expect(info).not.toHaveBeenCalled();
  proxy(request("localhost:3000"));
  proxy(page("localhost:3001"));
  expect(info).toHaveBeenCalledTimes(2);
  vi.stubEnv("BFF_PROXY_ENABLED", "true");
  proxy(page("next:3000"));
  expect(info).toHaveBeenCalledTimes(3);
  info.mockRestore();
 });
 it("echoes valid correlation and replaces malformed input on rejection",() => {vi.stubEnv("BFF_PROXY_ENABLED","true");const req=request("next:3000");req.headers.set("x-request-id","a".repeat(32));expect(proxy(req).headers.get("x-request-id")).toBe("a".repeat(32));req.headers.set("x-request-id","external");expect(proxy(req).headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/);});
});
