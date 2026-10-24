package com.patterncoach.bff.audit;
import com.patterncoach.bff.web.RequestIds;
import com.patterncoach.bff.observability.BffMetrics;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.http.*;
import org.springframework.web.server.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import reactor.core.publisher.Mono;
import java.nio.charset.StandardCharsets;
@Component @Order(-90)
public class RequestAuditFilter implements WebFilter {
    private static final Logger log=LoggerFactory.getLogger(RequestAuditFilter.class);
    private final AiRunAuditRepository repository;
    private final BffMetrics metrics;
    private final com.patterncoach.bff.config.BffProperties properties;
    private final com.fasterxml.jackson.databind.ObjectMapper mapper;
    public RequestAuditFilter(AiRunAuditRepository repository, BffMetrics metrics, com.patterncoach.bff.config.BffProperties properties,com.fasterxml.jackson.databind.ObjectMapper mapper) {this.properties=properties;this.mapper=mapper; this.repository=repository; this.metrics=metrics; }
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        if (exchange.getRequest().getPath().value().startsWith("/actuator")) return chain.filter(exchange);
        var audit=new AiRunAudit(exchange.getAttribute(RequestIds.MDC_KEY), AiRunAudit.route(exchange.getRequest().getPath().value()), exchange.getRequest().getMethod().name());
        exchange.getAttributes().put(AiRunAudit.ATTRIBUTE,audit);
        log.info("ingress requestId={} route={} method={}",audit.requestId,audit.route,audit.method);
        return Mono.usingWhen(repository.insert(audit).onErrorMap(e -> new AuditUnavailable()),
            ignored -> {
                String path=exchange.getRequest().getPath().value();
                if(!com.patterncoach.bff.gateway.RouteTable.known(path))return chain.filter(exchange);
                var policy=properties.getRoutes().get(com.patterncoach.bff.gateway.RouteTable.key(path));
                long remaining=java.time.Duration.ofSeconds(policy.getDeadlineSeconds()).toNanos()-(System.nanoTime()-audit.startedNanos);
                return Mono.defer(()->chain.filter(exchange)).timeout(Mono.delay(java.time.Duration.ofNanos(Math.max(1,remaining))).flatMap(t -> Boolean.TRUE.equals(exchange.getAttribute("bff.sse"))?Mono.never():Mono.just(t)))
                    .onErrorResume(java.util.concurrent.TimeoutException.class,x->com.patterncoach.bff.web.BffErrors.write(exchange,mapper,504,"TIMEOUT"));
            },
            ignored -> finish(exchange,audit,null),
            (ignored,error) -> finish(exchange,audit,error),
            ignored -> { if(!Boolean.TRUE.equals(exchange.getAttribute("bff.terminal"))) audit.result("client_disconnected","client",null); return finish(exchange,audit,null); })
            .onErrorResume(AuditUnavailable.class, e -> {
                metrics.auditFailure("insert");
                log.warn("audit_failed requestId={} phase=insert",audit.requestId);
                exchange.getResponse().setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
                exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
                exchange.getResponse().getHeaders().set("X-Failure-Source","bff");
                byte[] body=("{\"ok\":false,\"source\":\"bff\",\"error\":\"Audit unavailable\",\"code\":\"AUDIT_UNAVAILABLE\",\"status\":503,\"requestId\":\""+audit.requestId+"\"}").getBytes(StandardCharsets.UTF_8);
                return exchange.getResponse().writeWith(Mono.just(exchange.getResponse().bufferFactory().wrap(body)));
            });
    }
    private Mono<Void> finish(ServerWebExchange exchange,AiRunAudit audit,Throwable error) {
        if (!audit.finished.compareAndSet(false,true)) return Mono.empty();
        int status=exchange.getResponse().getStatusCode()==null ? 200 : exchange.getResponse().getStatusCode().value();
        if (audit.outcome==null) audit.result(error!=null || status>=400 ? "bff_rejected" : "success",error!=null || status>=400 ? "bff" : null,null);
        metrics.finished(audit.route,audit.outcome,System.nanoTime()-audit.startedNanos);
        log.info("terminal requestId={} route={} durationMs={} status={} upstreamStatus={} outcome={} source={} code={}",audit.requestId,audit.route,(System.nanoTime()-audit.startedNanos)/1_000_000,status,audit.upstreamStatus,audit.outcome,audit.errorSource,audit.errorCode);
        return repository.finish(audit,status).onErrorResume(e -> {metrics.auditFailure("finish");log.warn("audit_failed requestId={} phase=finish",audit.requestId);return Mono.empty();});
    }
    private static class AuditUnavailable extends RuntimeException {}
}
