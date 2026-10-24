package com.patterncoach.bff;
import com.patterncoach.bff.audit.*;
import com.patterncoach.bff.observability.BffMetrics;
import com.patterncoach.bff.web.RequestIds;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.*;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class AuditTest {
 @Test void insertsThenCompletesOnce() {
  var repo=mock(AiRunAuditRepository.class);when(repo.insert(any())).thenAnswer(i -> Mono.just(i.getArgument(0)));when(repo.finish(any(),anyInt())).thenReturn(Mono.empty());
  var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/chat"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));
  new RequestAuditFilter(repo,new BffMetrics(new SimpleMeterRegistry()),new com.patterncoach.bff.config.BffProperties(),new com.fasterxml.jackson.databind.ObjectMapper()).filter(e,x -> Mono.empty()).block();
  verify(repo,times(1)).insert(any());verify(repo,times(1)).finish(any(),eq(200));
 }
 @Test void unavailableAuditDoesNotDispatch() {
  var repo=mock(AiRunAuditRepository.class);when(repo.insert(any())).thenReturn(Mono.error(new IllegalStateException("private detail")));
  var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/chat"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));
  new RequestAuditFilter(repo,new BffMetrics(new SimpleMeterRegistry()),new com.patterncoach.bff.config.BffProperties(),new com.fasterxml.jackson.databind.ObjectMapper()).filter(e,x -> {throw new AssertionError("dispatched");}).block();
  assertThat(e.getResponse().getStatusCode().value()).isEqualTo(503);assertThat(e.getResponse().getBodyAsString().block()).contains("AUDIT_UNAVAILABLE").doesNotContain("private detail");
 }
 @Test void finalWriteFailureDoesNotRewriteResponse() {
  var repo=mock(AiRunAuditRepository.class);when(repo.insert(any())).thenAnswer(i -> Mono.just(i.getArgument(0)));when(repo.finish(any(),anyInt())).thenReturn(Mono.error(new RuntimeException()));
  var registry=new SimpleMeterRegistry();var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/chat"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));
  new RequestAuditFilter(repo,new BffMetrics(registry),new com.patterncoach.bff.config.BffProperties(),new com.fasterxml.jackson.databind.ObjectMapper()).filter(e,x -> Mono.empty()).block();assertThat(registry.get("bff.audit.failures").counter().count()).isEqualTo(1);
 }
}
