package com.patterncoach.bff.web;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;
// D3 adapted to a reactive filter; Reactor context replaces thread-local request identity.
@Component @Order(-100)
public class RequestIdFilter implements WebFilter {
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String id = RequestIds.normalize(exchange.getRequest().getHeaders().getFirst(RequestIds.HEADER));
        exchange.getAttributes().put(RequestIds.MDC_KEY, id);
        exchange.getResponse().getHeaders().set(RequestIds.HEADER, id);
        return chain.filter(exchange).contextWrite(context -> context.put(RequestIds.MDC_KEY, id));
    }
}
