package com.patterncoach.bff.web;
import java.util.UUID;
// D3: Chiron RequestIds constants, adapted to the Round 1 wire format.
public final class RequestIds {
    public static final String HEADER = "X-Request-ID";
    public static final String MDC_KEY = "requestId";
    private RequestIds() {}
    public static String normalize(String value) {
        return value != null && value.matches("[0-9a-f]{32}") ? value : UUID.randomUUID().toString().replace("-", "");
    }
}
