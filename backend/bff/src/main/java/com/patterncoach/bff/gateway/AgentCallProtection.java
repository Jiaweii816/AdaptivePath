package com.patterncoach.bff.gateway;
import com.patterncoach.bff.config.BffProperties;
import com.patterncoach.bff.audit.AiRunAudit;
import com.patterncoach.bff.web.JsonGatewayController;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.resilience4j.bulkhead.*;
import io.github.resilience4j.circuitbreaker.*;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
@Component @Order(-70)
public class AgentCallProtection implements WebFilter {
 private final BffProperties properties;private final ObjectMapper mapper;
 private final Map<String,Bulkhead> bulkheads=new HashMap<>(); private final Map<String,CircuitBreaker> circuits=new HashMap<>();
 public AgentCallProtection(BffProperties p,ObjectMapper mapper,MeterRegistry metrics){
  this.properties=p;this.mapper=mapper;
  var config=CircuitBreakerConfig.custom().slidingWindowSize(p.getCircuitWindow()).minimumNumberOfCalls(p.getCircuitMinimumCalls()).failureRateThreshold(p.getCircuitFailurePercent()).waitDurationInOpenState(Duration.ofSeconds(p.getCircuitOpenSeconds())).permittedNumberOfCallsInHalfOpenState(p.getCircuitHalfOpenCalls()).slowCallRateThreshold(100).slowCallDurationThreshold(Duration.ofDays(1)).build();
  for(var policy:p.getRoutes().values()) {String group=policy.getGroup();
   if(!bulkheads.containsKey(group)){var bh=Bulkhead.of(group,BulkheadConfig.custom().maxConcurrentCalls(policy.getCapacity()).maxWaitDuration(Duration.ZERO).build());bulkheads.put(group,bh);metrics.gauge("bff.bulkhead.available",List.of(io.micrometer.core.instrument.Tag.of("group",group)),bh,x -> x.getMetrics().getAvailableConcurrentCalls());
    var cb=CircuitBreaker.of(group,config);circuits.put(group,cb);metrics.gauge("bff.circuit.state",List.of(io.micrometer.core.instrument.Tag.of("group",group)),cb,x -> x.getState().getOrder());}
   else if(bulkheads.get(group).getBulkheadConfig().getMaxConcurrentCalls()!=policy.getCapacity())throw new IllegalStateException("Inconsistent shared bulkhead capacity");
  }
 }
 public Mono<Void> filter(ServerWebExchange e,WebFilterChain chain){
  String path=e.getRequest().getPath().value();if(!RouteTable.known(path))return chain.filter(e);
  var p=properties.getRoutes().get(RouteTable.key(path));var bh=bulkheads.get(p.getGroup());var cb=circuits.get(p.getGroup());
  return Mono.defer(() -> {
   if(!cb.tryAcquirePermission())return JsonGatewayController.failure(e,mapper,503,"CIRCUIT_OPEN");
   if(!bh.tryAcquirePermission()){cb.releasePermission();return JsonGatewayController.failure(e,mapper,503,"BULKHEAD_FULL");}
   long start=System.nanoTime();var recorded=new AtomicBoolean();var a=e.<AiRunAudit>getAttribute(AiRunAudit.ATTRIBUTE);
   long elapsed=a==null?0:System.nanoTime()-a.startedNanos;long remaining=Duration.ofSeconds(p.getDeadlineSeconds()).toNanos()-elapsed;
   Mono<Void> work=remaining<=0?Mono.error(new java.util.concurrent.TimeoutException()):Mono.defer(() -> chain.filter(e)).timeout(Mono.delay(Duration.ofNanos(remaining)).flatMap(t -> Boolean.TRUE.equals(e.getAttribute("bff.sse"))?Mono.never():Mono.just(t)));
   return work.onErrorResume(error -> {
    if(a!=null && ("success".equals(a.outcome)||"agent_error".equals(a.outcome))){return e.getResponse().setComplete();}
    boolean timeout=error instanceof java.util.concurrent.TimeoutException;
    return JsonGatewayController.failure(e,mapper,timeout?504:503,timeout?"TIMEOUT":"UPSTREAM_UNAVAILABLE");
   }).doOnSuccess(v -> {
    if(!recorded.compareAndSet(false,true))return;
    if(a==null || "success".equals(a.outcome))cb.onSuccess(System.nanoTime()-start,TimeUnit.NANOSECONDS);
    else if("bff_timeout".equals(a.outcome)||"bff_upstream_error".equals(a.outcome)||a.upstreamStatus!=null&&a.upstreamStatus>=500)cb.onError(System.nanoTime()-start,TimeUnit.NANOSECONDS,new RuntimeException("upstream failure"));
    else cb.releasePermission();
   }).doFinally(signal -> {bh.onComplete();if(recorded.compareAndSet(false,true))cb.releasePermission();});
  });
 }
}
