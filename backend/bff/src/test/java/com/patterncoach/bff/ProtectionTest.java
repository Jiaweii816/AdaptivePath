package com.patterncoach.bff;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.audit.AiRunAudit;
import com.patterncoach.bff.config.BffProperties;
import com.patterncoach.bff.web.RequestIds;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.*;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import java.time.Duration;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class ProtectionTest {
 private MockServerWebExchange exchange(){var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/chat"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));e.getAttributes().put(AiRunAudit.ATTRIBUTE,new AiRunAudit("a".repeat(32),"/api/coach/chat","POST"));return e;}
 @Test void deadlineIsTotalAndReturns504(){var p=new BffProperties();p.getRoutes().get("chat").setDeadlineSeconds(1);var e=exchange();var guard=new AgentCallProtection(p,new ObjectMapper(),new SimpleMeterRegistry());guard.filter(e,x -> Mono.never()).block(Duration.ofSeconds(3));assertThat(e.getResponse().getStatusCode().value()).isEqualTo(504);assertThat(e.getResponse().getBodyAsString().block()).contains("TIMEOUT");}
 @Test void bulkheadRejectsAndReleasesOnDisconnect(){var p=new BffProperties();var guard=new AgentCallProtection(p,new ObjectMapper(),new SimpleMeterRegistry());var first=guard.filter(exchange(),x -> Mono.never()).subscribe();try{var e=exchange();guard.filter(e,x -> Mono.empty()).block();assertThat(e.getResponse().getBodyAsString().block()).contains("BULKHEAD_FULL");}finally{first.dispose();}StepVerifier.create(guard.filter(exchange(),x -> Mono.empty())).verifyComplete();}
 @Test void routeDefaultsCoverAllNine(){var p=new BffProperties();assertThat(p.getRoutes()).hasSize(9);assertThat(p.getRoutes().get("review").getDeadlineSeconds()).isEqualTo(180);assertThat(p.getRoutes().get("run").getGroup()).isEqualTo(p.getRoutes().get("run-code").getGroup());}
 @Test void circuitOpensOnUpstreamFailureOnly(){var p=new BffProperties();p.setCircuitMinimumCalls(2);p.setCircuitWindow(2);var guard=new AgentCallProtection(p,new ObjectMapper(),new SimpleMeterRegistry());for(int i=0;i<2;i++){var e=exchange();guard.filter(e,x->{e.<AiRunAudit>getAttribute(AiRunAudit.ATTRIBUTE).result("bff_upstream_error","bff","UPSTREAM_UNAVAILABLE");return Mono.empty();}).block();}var e=exchange();guard.filter(e,x -> {throw new AssertionError("must not dispatch");}).block();assertThat(e.getResponse().getBodyAsString().block()).contains("CIRCUIT_OPEN");}
}
