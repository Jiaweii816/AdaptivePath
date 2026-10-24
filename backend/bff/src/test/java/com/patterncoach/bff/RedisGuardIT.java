package com.patterncoach.bff;
import com.patterncoach.bff.gateway.RedisRequestGuard;
import com.patterncoach.bff.config.*;
import com.patterncoach.bff.web.RequestIds;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.GenericContainer;
import org.redisson.api.RedissonClient;
import org.redisson.client.codec.StringCodec;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class RedisGuardIT {
 static GenericContainer<?> container;static RedissonClient client;static RedisRequestGuard guard;
 @BeforeAll static void start(){container=new GenericContainer<>("redis:7-alpine").withExposedPorts(6379).withStartupTimeout(Duration.ofSeconds(40));container.start();client=RedissonConfiguration.create("redis://"+container.getHost()+":"+container.getMappedPort(6379));guard=new RedisRequestGuard(client,new BffProperties(),new ObjectMapper(),new SimpleMeterRegistry());}
 @AfterAll static void stop(){if(client!=null)client.shutdown();if(container!=null)container.stop();}
 @Test void atomicQuotaTtlAndOwnerSafeLease() {
  String key="coach:r1:test:round1-test:flight:problem:id:atomic";
  var wins=Flux.range(0,32).flatMap(i->guard.acquire(key,"r"+i,135),32).collectList().block(Duration.ofSeconds(5));assertThat(wins.stream().filter(Boolean::booleanValue).count()).isEqualTo(1);
  var bucket=client.getBucket(key,StringCodec.INSTANCE);assertThat(bucket.remainTimeToLive()).isBetween(125000L,135000L);String owner=(String)bucket.get();assertThat(guard.release(key,"wrong").block()).isZero();assertThat(bucket.get()).isEqualTo(owner);
  bucket.set("successor");assertThat(guard.release(key,owner).block()).isZero();assertThat(bucket.get()).isEqualTo("successor");bucket.delete();
  var counts=Flux.range(0,32).flatMap(i->guard.rate("atomic"),32).map(x->((Number)x.get(0)).intValue()).collectList().block(Duration.ofSeconds(5));assertThat(new HashSet<>(counts)).hasSize(32);assertThat(Collections.max(counts)).isEqualTo(32);
  for(String k:client.getKeys().getKeysByPattern("coach:r1:test:round1-test:rate:atomic:*"))assertThat(client.getBucket(k).remainTimeToLive()).isBetween(110000L,120000L);
 }
 @Test void holdsThroughRequestAndReleasesOnDisconnect() {
  var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/coach/chat").body("{\"problemId\":\"long\"}"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));var began=new java.util.concurrent.CountDownLatch(1);var active=guard.filter(e,x->{began.countDown();return Mono.never();}).subscribe();
  try{assertThat(began.await(3,java.util.concurrent.TimeUnit.SECONDS)).isTrue();}catch(InterruptedException ex){Thread.currentThread().interrupt();throw new RuntimeException(ex);}
  String key=RedisRequestGuard.scopeKey("review",new ObjectMapper().valueToTree(Map.of("problemId","long")),new BffProperties().namespace());assertThat(guard.acquire(key,"second",195).block()).isFalse();active.dispose();
  for(int i=0;i<100&&client.getBucket(key).isExists();i++){try{Thread.sleep(10);}catch(InterruptedException ex){Thread.currentThread().interrupt();throw new RuntimeException(ex);}}
  assertThat(client.getBucket(key).isExists()).isFalse();
 }
 @Test void noLockRunnerAndUnavailableRedisPreventsDispatch(){var e=MockServerWebExchange.from(MockServerHttpRequest.post("/api/workbench/run").body("{}"));e.getAttributes().put(RequestIds.MDC_KEY,"a".repeat(32));var calls=new AtomicInteger();guard.filter(e,x->{calls.incrementAndGet();return Mono.empty();}).block(Duration.ofSeconds(3));assertThat(calls.get()).isEqualTo(1);client.shutdown();var rejected=MockServerWebExchange.from(MockServerHttpRequest.post("/api/workbench/run").body("{}"));rejected.getAttributes().put(RequestIds.MDC_KEY,"b".repeat(32));guard.filter(rejected,x->{calls.incrementAndGet();return Mono.empty();}).block(Duration.ofSeconds(3));assertThat(rejected.getResponse().getStatusCode().value()).isEqualTo(503);assertThat(calls.get()).isEqualTo(1);client=RedissonConfiguration.create("redis://"+container.getHost()+":"+container.getMappedPort(6379));guard=new RedisRequestGuard(client,new BffProperties(),new ObjectMapper(),new SimpleMeterRegistry());}
}
