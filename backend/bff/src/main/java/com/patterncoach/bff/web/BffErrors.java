package com.patterncoach.bff.web;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.patterncoach.bff.audit.AiRunAudit;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.http.*;
import reactor.core.publisher.Mono;
public final class BffErrors {
 private BffErrors(){}
 public static String text(ServerWebExchange e,ObjectMapper mapper,int status,String code,boolean sse){
  try{var fields=new java.util.LinkedHashMap<String,Object>();fields.put("ok",false);fields.put("source","bff");fields.put("error","Request could not be completed");fields.put("code",code);fields.put("status",status);fields.put("requestId",e.getAttributeOrDefault(RequestIds.MDC_KEY,""));if(sse)fields.put("type","bff_error");String json=mapper.writeValueAsString(fields);return sse?"event: bff_error\ndata: "+json+"\n\n":json;}catch(Exception x){throw new IllegalStateException(x);}
 }
 public static Mono<Void> write(ServerWebExchange e,ObjectMapper mapper,int status,String code) {
  if(Boolean.TRUE.equals(e.getAttribute("bff.terminal")))return e.getResponse().setComplete();
  var a=e.<AiRunAudit>getAttribute(AiRunAudit.ATTRIBUTE);if(a!=null)a.result(status==504?"bff_timeout":code.startsWith("UPSTREAM")?"bff_upstream_error":"bff_rejected","bff",code);
  boolean sse=Boolean.TRUE.equals(e.getAttribute("bff.sse"));
  if(!sse){e.getResponse().setStatusCode(HttpStatusCode.valueOf(status));e.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);e.getResponse().getHeaders().set("X-Failure-Source","bff");}
  return e.getResponse().writeWith(Mono.just(e.getResponse().bufferFactory().wrap(text(e,mapper,status,code,sse).getBytes(java.nio.charset.StandardCharsets.UTF_8))));
 }
}
