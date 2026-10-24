package com.patterncoach.bff.web;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.audit.AiRunAudit;
import com.patterncoach.bff.config.BffProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.web.server.*;
import org.springframework.http.*;
import org.springframework.core.io.buffer.*;
import reactor.core.publisher.*;
import java.nio.charset.StandardCharsets;
import org.slf4j.LoggerFactory;
@Component @Order(-55)
public class ReviewGatewayController implements WebFilter {
 private final NextAgentClient client;private final ObjectMapper mapper;private final BffProperties properties;private final MeterRegistry metrics;
 public ReviewGatewayController(NextAgentClient client,ObjectMapper mapper,BffProperties p,MeterRegistry metrics){this.client=client;this.mapper=mapper;properties=p;this.metrics=metrics;}
 public Mono<Void> filter(ServerWebExchange e,WebFilterChain chain){
  if(!e.getRequest().getPath().value().equals("/api/coach/review")||e.getRequest().getMethod()!=HttpMethod.POST||!e.getRequest().getHeaders().getAccept().contains(MediaType.TEXT_EVENT_STREAM))return chain.filter(e);
  return JsonGatewayController.body(e,properties.getRequestBytes()).flatMap(body -> {
   try{if(mapper.readTree(body)==null)return JsonGatewayController.failure(e,mapper,400,"INVALID_REQUEST");}catch(Exception ex){return JsonGatewayController.failure(e,mapper,400,"INVALID_REQUEST");}
   return client.request("/api/coach/review",body,e.getAttribute(RequestIds.MDC_KEY),"application/x-ndjson").exchangeToMono(upstream -> {
    var a=e.<AiRunAudit>getAttribute(AiRunAudit.ATTRIBUTE);if(a!=null)a.upstreamStatus=upstream.statusCode().value();
    if(upstream.headers().header("X-Coach-Proxy-Error").contains("INTERNAL_TOKEN_INVALID"))return upstream.releaseBody().then(JsonGatewayController.failure(e,mapper,503,"UPSTREAM_AUTH_FAILED"));
    if(!upstream.statusCode().is2xxSuccessful())return upstream.bodyToMono(byte[].class).defaultIfEmpty(new byte[0]).flatMap(bytes -> {
     if(a!=null)a.result("agent_error","agent",null);e.getResponse().setStatusCode(upstream.statusCode());e.getResponse().getHeaders().setContentType(upstream.headers().contentType().orElse(MediaType.APPLICATION_JSON));e.getResponse().getHeaders().set("X-Failure-Source","agent");return e.getResponse().writeWith(Mono.just(e.getResponse().bufferFactory().wrap(bytes)));});
    if(!upstream.headers().contentType().map(x -> x.isCompatibleWith(MediaType.valueOf("application/x-ndjson"))).orElse(false))return upstream.releaseBody().then(JsonGatewayController.failure(e,mapper,503,"UPSTREAM_PROTOCOL_ERROR"));
    e.getAttributes().put("bff.sse",true);e.getResponse().getHeaders().setContentType(new MediaType("text","event-stream",StandardCharsets.UTF_8));e.getResponse().getHeaders().setCacheControl("no-store, no-transform");e.getResponse().getHeaders().set("X-Accel-Buffering","no");
    var decoder=new ReviewNdjsonDecoder(mapper,properties.getLineBytes(),properties.getStreamBytes(),() -> {metrics.counter("bff.stream.anomalies").increment();LoggerFactory.getLogger(getClass()).warn("post_terminal_data requestId={}",e.getAttributeOrDefault(RequestIds.MDC_KEY,""));},type -> {e.getAttributes().put("bff.terminal",true);if(a!=null)a.result(type.equals("complete")?"success":"agent_error",type.equals("complete")?null:"agent",null);});
    long deadline=(a==null?System.nanoTime():a.startedNanos)+java.time.Duration.ofSeconds(properties.getRoutes().get("review").getDeadlineSeconds()).toNanos();
    java.util.function.Supplier<Mono<Long>> deadlineSignal=()->Mono.defer(()->Mono.delay(java.time.Duration.ofNanos(Math.max(1,deadline-System.nanoTime()))));
    Flux<String> frames=decoder.decode(upstream.bodyToFlux(DataBuffer.class)).timeout(deadlineSignal.get(),frame->deadlineSignal.get()).onErrorResume(error -> {
     if(decoder.terminalSeen()){metrics.counter("bff.stream.anomalies").increment();return Flux.empty();}
     String code=error instanceof java.util.concurrent.TimeoutException?"TIMEOUT":"UPSTREAM_PROTOCOL_ERROR".equals(error.getMessage())?"UPSTREAM_PROTOCOL_ERROR":"UPSTREAM_UNAVAILABLE";
     if(a!=null)a.result(code.equals("TIMEOUT")?"bff_timeout":"bff_upstream_error","bff",code);return Flux.just(JsonGatewayController.errorText(e,mapper,code.equals("TIMEOUT")?504:503,code,true));});
    // Empty first buffer commits headers immediately, without a fabricated SSE event.
    return e.getResponse().writeAndFlushWith(Flux.concat(Mono.just(""),frames).map(frame -> Mono.just(e.getResponse().bufferFactory().wrap(frame.getBytes(StandardCharsets.UTF_8)))));
   });
  }).onErrorResume(DataBufferLimitException.class,x -> JsonGatewayController.failure(e,mapper,413,"INPUT_TOO_LARGE"));
 }
}
