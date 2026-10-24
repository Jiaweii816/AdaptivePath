package com.patterncoach.bff.gateway;
import com.patterncoach.bff.config.BffProperties;
import com.patterncoach.bff.web.*;
import com.fasterxml.jackson.databind.*;
import org.redisson.api.*;
import org.redisson.client.codec.StringCodec;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.web.server.*;
import org.springframework.http.HttpMethod;
import io.micrometer.core.instrument.MeterRegistry;
import reactor.core.publisher.Mono;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletionStage;
@Component @Order(-80)
public class RedisRequestGuard implements WebFilter {
 public static final String ACQUIRE="return redis.call('SET',KEYS[1],ARGV[1],'NX','EX',ARGV[2]) and 1 or 0";
 public static final String RELEASE="if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
 public static final String RATE="local now=tonumber(redis.call('TIME')[1]); local k=ARGV[1]..math.floor(now/60); local n=redis.call('INCR',k); if n==1 then redis.call('EXPIRE',k,120) end; return {n,60-now%60}";
 private final RedissonClient redis;private final BffProperties properties;private final ObjectMapper mapper;private final MeterRegistry metrics;
 public RedisRequestGuard(RedissonClient r,BffProperties p,ObjectMapper m,MeterRegistry metrics){redis=r;properties=p;mapper=m;this.metrics=metrics;
  Map<String,Integer> quotas=new HashMap<>();for(var policy:p.getRoutes().values()){Integer old=quotas.putIfAbsent(policy.getRateGroup(),policy.getQuota());if(old!=null&&old!=policy.getQuota())throw new IllegalStateException("Inconsistent shared rate quota");}}
 public Mono<Void> filter(ServerWebExchange e,WebFilterChain chain){
  String path=e.getRequest().getPath().value();if(!RouteTable.known(path))return chain.filter(e);
  if(e.getRequest().getMethod()!=HttpMethod.POST)return deny(e,405,"METHOD_NOT_ALLOWED");
  return JsonGatewayController.body(e,properties.getRequestBytes()).flatMap(body -> {
   JsonNode node;try{node=mapper.readTree(body);if(node==null)return deny(e,400,"INVALID_REQUEST");}catch(Exception x){return deny(e,400,"INVALID_REQUEST");}
   e.getAttributes().put("bff.body",body);var policy=properties.getRoutes().get(RouteTable.key(path));String key=scopeKey(RouteTable.key(path),node,properties.namespace());String owner=e.getAttribute(RequestIds.MDC_KEY);
   Mono<String> lease=key==null?Mono.just(""):acquire(key,owner,policy.getDeadlineSeconds()+15).flatMap(ok -> ok?Mono.just(key):Mono.error(new Denied(409,"AI_BUSY")));
   return Mono.usingWhen(lease,
    owned -> rate(policy.getRateGroup()).flatMap(result -> {
     long count=((Number)result.get(0)).longValue();if(count>policy.getQuota()){e.getResponse().getHeaders().set("Retry-After",result.get(1).toString());return deny(e,429,"RATE_LIMITED");}
     return chain.filter(e);
    }),owned -> cleanup(owned,owner), (owned,error)->cleanup(owned,owner),owned->cleanup(owned,owner));
  }).onErrorResume(Denied.class,x->deny(e,x.status,x.code))
   .onErrorResume(org.springframework.core.io.buffer.DataBufferLimitException.class,x->deny(e,413,"INPUT_TOO_LARGE"))
   .onErrorResume(x->deny(e,503,"REDIS_UNAVAILABLE"));
 }
 private Mono<Void> deny(ServerWebExchange e,int status,String code){metrics.counter("bff.denials","code",code).increment();return BffErrors.write(e,mapper,status,code);}
 public Mono<Boolean> acquire(String key,String owner,int ttl){return this.<Number>eval(ACQUIRE,List.of(key),owner,Integer.toString(ttl)).map(n->n.intValue()==1);}
 public Mono<Long> release(String key,String owner){return this.<Number>eval(RELEASE,List.of(key),owner).map(Number::longValue);}
 public Mono<List<Object>> rate(String group){return evalMulti(RATE,List.of(),properties.namespace()+"rate:"+group+":");}
 public Mono<Boolean> ping(){return this.<String>evalValue("return redis.call('PING')",List.of()).map("PONG"::equals);}
 private <T> Mono<T> eval(String script,List<Object> keys,Object...args){return Mono.defer(()->Mono.fromCompletionStage(redis.getScript(StringCodec.INSTANCE).<T>evalAsync(RScript.Mode.READ_WRITE,script,RScript.ReturnType.INTEGER,keys,args))).timeout(Duration.ofSeconds(1));}
 private Mono<List<Object>> evalMulti(String script,List<Object> keys,Object...args){return Mono.defer(()->Mono.fromCompletionStage(redis.getScript(StringCodec.INSTANCE).<List<Object>>evalAsync(RScript.Mode.READ_WRITE,script,RScript.ReturnType.MULTI,keys,args))).timeout(Duration.ofSeconds(1));}
 private <T> Mono<T> evalValue(String script,List<Object> keys,Object...args){return Mono.defer(()->Mono.fromCompletionStage(redis.getScript(StringCodec.INSTANCE).<T>evalAsync(RScript.Mode.READ_ONLY,script,RScript.ReturnType.VALUE,keys,args))).timeout(Duration.ofSeconds(1));}
 private Mono<Void> cleanup(String key,String owner){if(key.isEmpty())return Mono.empty();return release(key,owner).then().onErrorResume(x->{metrics.counter("bff.redis.release.failures").increment();org.slf4j.LoggerFactory.getLogger(getClass()).warn("redis_release_failed requestId={}",owner);return Mono.empty();});}
 public static String scopeKey(String route,JsonNode body,String ns){return switch(route){
  case "review","chat","clear" -> ns+"flight:problem:"+problemScope(body);
  case "start" -> ns+"flight:start:single-learner";
  case "respond","send-code","complete" -> ns+"flight:session:"+component(body.path("sessionId").asText("missing"));
  default -> null;};}
 private static String problemScope(JsonNode node){for(String name:new String[]{"problemId","problemSlug","chatSessionId"}){String v=node.path(name).asText("");if(!v.isBlank())return (name.equals("problemId")?"id:":name.equals("problemSlug")?"slug:":"chat:")+component(v);}return "missing";}
 private static String component(String value){return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));}
 private static class Denied extends RuntimeException{final int status;final String code;Denied(int s,String c){status=s;code=c;}}
}
