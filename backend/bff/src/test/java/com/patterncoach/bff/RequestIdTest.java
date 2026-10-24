package com.patterncoach.bff;
import com.patterncoach.bff.web.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class RequestIdTest {
 @Test void propagatesContextAndEcho() {
  String id="a".repeat(32);var e=MockServerWebExchange.from(MockServerHttpRequest.get("/").header(RequestIds.HEADER,id));
  new RequestIdFilter().filter(e,x -> Mono.deferContextual(c -> {assertThat(c.<String>get(RequestIds.MDC_KEY)).isEqualTo(id);return Mono.empty();})).block();
  assertThat(e.getResponse().getHeaders().getFirst(RequestIds.HEADER)).isEqualTo(id);
 }
 @Test void replacesUntrustedIds() {for(String value:new String[]{"", "secret\nforged", "a".repeat(33),"A".repeat(32)}) assertThat(RequestIds.normalize(value)).matches("[0-9a-f]{32}").isNotEqualTo(value);}
}
