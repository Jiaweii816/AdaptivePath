package com.patterncoach.bff.web;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.audit.AiRunAudit;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.web.server.*;
import org.springframework.http.*;
import org.springframework.core.io.buffer.DataBufferUtils;
import reactor.core.publisher.Mono;
import java.util.Map;
@Component @Order(-50)
public class JsonGatewayController implements WebFilter {
 private final NextAgentClient client; private final ObjectMapper mapper; private final int requestLimit;
 public JsonGatewayController(NextAgentClient client,ObjectMapper mapper,com.patterncoach.bff.config.BffProperties properties) {this.client=client;this.mapper=mapper;this.requestLimit=properties.getRequestBytes();}
 public Mono<Void> filter(ServerWebExchange e,WebFilterChain chain) {
  String path=e.getRequest().getPath().value();
  if(path.startsWith("/actuator"))return chain.filter(e);
  if(!RouteTable.known(path))return failure(e,mapper,404,"NOT_FOUND");
  if(e.getRequest().getMethod()!=HttpMethod.POST)return failure(e,mapper,405,"METHOD_NOT_ALLOWED");
  if(!RouteTable.json(path))return chain.filter(e);
  return body(e,requestLimit)
   .flatMap(body -> {try {if(mapper.readTree(body)==null)return failure(e,mapper,400,"INVALID_REQUEST");}catch(Exception ex){return failure(e,mapper,400,"INVALID_REQUEST");}
    return client.json(path,body,e.getAttribute(RequestIds.MDC_KEY)).flatMap(reply -> {
     if(reply.internalAuthFailure())return failure(e,mapper,503,"UPSTREAM_AUTH_FAILED");
     var a=e.<AiRunAudit>getAttribute(AiRunAudit.ATTRIBUTE);
     boolean error=reply.status()>=400;
     try {var json=mapper.readTree(reply.body());if(json==null||!reply.contentType().isCompatibleWith(MediaType.APPLICATION_JSON))return failure(e,mapper,503,"UPSTREAM_PROTOCOL_ERROR");error=error || json.path("ok").isBoolean() && !json.path("ok").asBoolean();}catch(Exception invalid){return failure(e,mapper,503,"UPSTREAM_PROTOCOL_ERROR");}
     if(a!=null){a.upstreamStatus=reply.status();a.result(error?"agent_error":"success",error?"agent":null,null);}
     e.getResponse().setStatusCode(HttpStatusCode.valueOf(reply.status()));e.getResponse().getHeaders().setContentType(reply.contentType());
     if(error)e.getResponse().getHeaders().set("X-Failure-Source","agent");
     return e.getResponse().writeWith(Mono.just(e.getResponse().bufferFactory().wrap(reply.body())));
    });})
   .onErrorResume(org.springframework.core.io.buffer.DataBufferLimitException.class,x -> failure(e,mapper,413,"INPUT_TOO_LARGE"))
   .onErrorResume(x -> failure(e,mapper,503,"UPSTREAM_PROTOCOL_ERROR".equals(x.getMessage())?"UPSTREAM_PROTOCOL_ERROR":"UPSTREAM_UNAVAILABLE"));
 }
 public static Mono<byte[]> body(ServerWebExchange e,int limit) {
  byte[] cached=e.getAttribute("bff.body");if(cached!=null)return Mono.just(cached);
  return DataBufferUtils.join(e.getRequest().getBody(),limit).map(buffer -> {byte[] bytes=new byte[buffer.readableByteCount()];buffer.read(bytes);DataBufferUtils.release(buffer);return bytes;}).defaultIfEmpty(new byte[0]);
 }
 public static String errorText(ServerWebExchange e,ObjectMapper m,int s,String c,boolean stream){return BffErrors.text(e,m,s,c,stream);}
 public static Mono<Void> failure(ServerWebExchange e,ObjectMapper m,int s,String c){return BffErrors.write(e,m,s,c);}
}
