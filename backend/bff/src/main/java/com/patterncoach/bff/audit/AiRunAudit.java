package com.patterncoach.bff.audit;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
public final class AiRunAudit {
    public static final String ATTRIBUTE = AiRunAudit.class.getName();
    public final UUID id = UUID.randomUUID();
    public final String requestId, route, method;
    public final Instant startedAt = Instant.now();
    public final long startedNanos = System.nanoTime();
    public final AtomicBoolean finished = new AtomicBoolean();
    public volatile String outcome, errorSource, errorCode;
    public volatile Integer upstreamStatus;
    public AiRunAudit(String requestId, String route, String method) {
        this.requestId=requestId; this.route=route; this.method=method;
    }
    public void result(String outcome, String source, String code) {
        this.outcome=outcome; this.errorSource=source; this.errorCode=code;
    }
    public static String route(String path) {
        return switch (path) {
            case "/api/coach/review", "/api/coach/chat", "/api/coach/chat/clear", "/api/workbench/run",
                 "/api/mock-interview/start", "/api/mock-interview/respond", "/api/mock-interview/send-code",
                 "/api/mock-interview/run-code", "/api/mock-interview/complete" -> path;
            default -> "unknown";
        };
    }
}
