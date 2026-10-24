package com.patterncoach.bff;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.config.BffProperties;
import com.patterncoach.bff.web.RequestIds;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.*;
import org.redisson.api.RedissonClient;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class RedisGuardTest {
 private final ObjectMapper mapper=new ObjectMapper();
 RedisRequestGuard guard(){return spy(new RedisRequestGuard(mock(RedissonClient.class),new BffProperties(),mapper,new SimpleMeterRegistry()));}
 MockServerWebExchange exchange(String route){var e=MockServerWebExchange.from(MockServerHttpRequest.post(route).body("{\"problemId\":\"p1\"}"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));return e;}
 @Test void problemAndSessionScopesAreSharedAndTyped() throws Exception {
  var node=mapper.readTree("{\"problemId\":\"x\",\"problemSlug\":\"s\"}");String key=RedisRequestGuard.scopeKey("review",node,"ns:");
  assertThat(key).isEqualTo(RedisRequestGuard.scopeKey("chat",node,"ns:")).isEqualTo(RedisRequestGuard.scopeKey("clear",node,"ns:"));
  assertThat(key).contains("flight:problem:id:");assertThat(key).isNotEqualTo(RedisRequestGuard.scopeKey("review",mapper.readTree("{\"problemSlug\":\"x\"}"),"ns:"));
  assertThat(RedisRequestGuard.scopeKey("run",node,"ns:")).isNull();assertThat(RedisRequestGuard.scopeKey("run-code",node,"ns:")).isNull();
  assertThat(RedisRequestGuard.scopeKey("respond",node,"ns:")).isEqualTo(RedisRequestGuard.scopeKey("complete",node,"ns:"));
 }
 @Test void contentionDoesNotConsumeQuotaOrDispatch(){var g=guard();doReturn(Mono.just(false)).when(g).acquire(anyString(),anyString(),eq(135));var e=exchange("/api/coach/chat");var calls=new AtomicInteger();g.filter(e,x->{calls.incrementAndGet();return Mono.empty();}).block();assertThat(e.getResponse().getStatusCode().value()).isEqualTo(409);assertThat(calls.get()).isZero();verify(g,never()).rate(anyString());}
 @Test void rateDenialReleasesOwnedLock(){var g=guard();doReturn(Mono.just(true)).when(g).acquire(anyString(),anyString(),eq(135));doReturn(Mono.just(List.of(11L,42L))).when(g).rate("ai");doReturn(Mono.just(1L)).when(g).release(anyString(),anyString());var e=exchange("/api/coach/chat");g.filter(e,x->Mono.error(new AssertionError("dispatch"))).block();assertThat(e.getResponse().getStatusCode().value()).isEqualTo(429);assertThat(e.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("42");verify(g).release(anyString(),eq("a".repeat(32)));}
 @Test void redisOutageFailsClosed(){var g=guard();doReturn(Mono.error(new IllegalStateException())).when(g).rate("runner");var e=exchange("/api/workbench/run");g.filter(e,x->Mono.error(new AssertionError("dispatch"))).block();assertThat(e.getResponse().getStatusCode().value()).isEqualTo(503);assertThat(e.getResponse().getBodyAsString().block()).contains("REDIS_UNAVAILABLE");}
}
