import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { WEBUI_LOCAL_URL, WEBUI_PORT_STRING } from "./src/lib/webui-port";

function getHostPort(host: string): string | null {
  const normalizedHost = host.trim();
  if (!normalizedHost) {
    return null;
  }

  if (normalizedHost.startsWith("[")) {
    return normalizedHost.match(/\]:(\d+)$/)?.[1] ?? null;
  }

  const separatorIndex = normalizedHost.lastIndexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  return normalizedHost.slice(separatorIndex + 1);
}

export function proxy(request: NextRequest) {
  const incomingId = request.headers.get("x-request-id");
  const requestId = incomingId && /^[0-9a-f]{32}$/.test(incomingId)
    ? incomingId : randomBytes(16).toString("hex");
  const pathname = request.nextUrl.pathname;
  const bffRoute = pathname.startsWith("/api/coach/") || pathname === "/api/workbench/run" || pathname.startsWith("/api/mock-interview/");
  const deployed = process.env.BFF_PROXY_ENABLED === "true";
  const host = request.headers.get("host") ?? "";
  const secret = process.env.BFF_INTERNAL_TOKEN ?? "";
  const supplied = request.headers.get("x-coach-internal-token") ?? "";
  const validToken = secret.length > 0 && Buffer.byteLength(secret) === Buffer.byteLength(supplied)
    && timingSafeEqual(Buffer.from(secret), Buffer.from(supplied));
  let response: NextResponse;
  let decision = "allow";
  if (deployed && bffRoute && !validToken) {
    decision = "internal-token-rejected";
    response = new NextResponse("Internal service authentication required.", {
      status: 403, headers: { "X-Coach-Proxy-Error": "INTERNAL_TOKEN_INVALID" },
    });
  } else if (getHostPort(host) !== WEBUI_PORT_STRING || (deployed &&
    !(process.env.NEXT_ALLOWED_HOSTS ?? "next:3000").split(",").map((value) => value.trim()).includes(host))) {
    decision = "host-rejected";
    response = new NextResponse(`PatternCoach WebUI requires the configured Host on ${WEBUI_LOCAL_URL}.`, { status: 421 });
  } else {
    const headers = new Headers(request.headers);
    headers.set("X-Request-ID", requestId);
    response = NextResponse.next({ request: { headers } });
  }
  response.headers.set("X-Request-ID", requestId);
  // Local direct use logs only BFF-routed paths and rejections, so page and
  // asset loads do not flood `npm run dev`. Deployed mode logs every request.
  if (deployed || bffRoute || decision !== "allow") {
    // Deliberately no query string, request body or credential headers.
    console.info(JSON.stringify({ requestId, method: request.method, path: pathname, decision }));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
