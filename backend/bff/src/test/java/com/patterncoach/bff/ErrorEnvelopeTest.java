package com.patterncoach.bff;
import com.patterncoach.bff.web.*;
import com.patterncoach.bff.audit.AiRunAudit;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class ErrorEnvelopeTest {
 @Test void statusesAndSourcesAreExplicit() throws Exception {for(int status:new int[]{409,429,503,504}){var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/chat"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));BffErrors.write(e,new ObjectMapper(),status,status==504?"TIMEOUT":"AI_BUSY").block();var json=new ObjectMapper().readTree(e.getResponse().getBodyAsString().block());assertThat(json.path("source").asText()).isEqualTo("bff");assertThat(json.path("status").asInt()).isEqualTo(status);assertThat(json.path("requestId").asText()).hasSize(32);assertThat(e.getResponse().getHeaders().getFirst("X-Failure-Source")).isEqualTo("bff");}}
 @Test void committedStreamGetsOneBffTerminalAndKeepsHttpStatus(){var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/review"));e.getAttributes().put("bff.sse",true);e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));BffErrors.write(e,new ObjectMapper(),504,"TIMEOUT").block();assertThat(e.getResponse().getBodyAsString().block()).contains("event: bff_error").contains("\"status\":504");assertThat(e.getResponse().getStatusCode()).isNull();}
}
