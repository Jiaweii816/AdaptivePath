package com.patterncoach.bff;
import com.patterncoach.bff.config.*;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.web.RequestIds;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.reactive.context.ReactiveWebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.http.MediaType;
import org.redisson.api.RedissonClient;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;
/** Real BFF/PG/Redis and HTTP fixture; NOT a real Next/provider acceptance test. */
@Timeout(60) @TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class StackIT {
 static PostgreSQLContainer<?> pg;static GenericContainer<?> redis;static HttpServer agent;static ReactiveWebServerApplicationContext app;static WebTestClient web;static JdbcTemplate jdbc;static AtomicInteger calls=new AtomicInteger();
 @BeforeAll static void start() throws Exception {
  pg=new PostgreSQLContainer<>("postgres:16-alpine").withStartupTimeout(Duration.ofSeconds(35));pg.start();
  redis=new GenericContainer<>("redis:7-alpine").withExposedPorts(6379).withStartupTimeout(Duration.ofSeconds(35));redis.start();
  agent=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);agent.setExecutor(java.util.concurrent.Executors.newCachedThreadPool(r->{var t=new Thread(r);t.setDaemon(true);return t;}));
  agent.createContext("/",x->{calls.incrementAndGet();String body=new String(x.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   assertThat(x.getRequestHeaders().getFirst("X-Coach-Internal-Token")).isEqualTo("test-secret");
   if(body.contains("authFault")){x.getResponseHeaders().set("X-Coach-Proxy-Error","INTERNAL_TOKEN_INVALID");x.sendResponseHeaders(403,-1);x.close();return;}
   if(x.getRequestHeaders().getFirst("Accept").contains("x-ndjson")){
    x.getResponseHeaders().set("Content-Type","application/x-ndjson");x.sendResponseHeaders(200,0);
    try{if(body.contains("stall")){Thread.sleep(3500);}else if(body.contains("badStream")){x.getResponseBody().write("broken\n".getBytes());}else{x.getResponseBody().write("{\"type\":\"evidence\",\"evidence\":{\"unchanged\":true}}\n".getBytes());x.getResponseBody().flush();Thread.sleep(30);x.getResponseBody().write("{\"type\":\"complete\",\"result\":{\"ok\":true}}\nlate".getBytes());}}
    catch(Exception ignored){}finally{x.close();}return;
   }
   if(body.contains("stallJson")){try{Thread.sleep(1500);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}}
   byte[] response=(body.contains("agentFault")?"{\"ok\":false,\"error\":\"agent unchanged\"}":"{ \"ok\": true, \"fixture\": true }").getBytes();x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(body.contains("agentFault")?422:200,response.length);x.getResponseBody().write(response);x.close();
  });agent.start();
  app=(ReactiveWebServerApplicationContext)new SpringApplicationBuilder(BffApplication.class).run(Map.ofEntries(
   Map.entry("server.port","0"),Map.entry("spring.datasource.url",pg.getJdbcUrl()),Map.entry("spring.datasource.username",pg.getUsername()),Map.entry("spring.datasource.password",pg.getPassword()),Map.entry("bff.internal-token","test-secret"),Map.entry("bff.next-base-url","http://127.0.0.1:"+agent.getAddress().getPort()),Map.entry("bff.redis-address","redis://"+redis.getHost()+":"+redis.getMappedPort(6379)),Map.entry("bff.circuit-minimum-calls","2"),Map.entry("bff.routes.review.deadline-seconds","2")).entrySet().stream().map(kv->"--"+kv.getKey()+"="+kv.getValue()).toArray(String[]::new));
  web=WebTestClient.bindToServer().baseUrl("http://127.0.0.1:"+app.getWebServer().getPort()).responseTimeout(Duration.ofSeconds(5)).build();jdbc=app.getBean(JdbcTemplate.class);
 }
 @AfterAll static void stop(){if(app!=null)app.close();if(agent!=null)agent.stop(0);if(redis!=null)redis.stop();if(pg!=null)pg.stop();}
 @BeforeEach void cleanRates(){app.getBean(RedissonClient.class).getKeys().deleteByPattern("coach:r1:test:round1-test:rate:*");}
 @Test @Order(1) void nineRoutesAuditAndHeaderProvenance(){for(String route:List.of("/api/coach/review","/api/coach/chat","/api/coach/chat/clear","/api/workbench/run","/api/mock-interview/start","/api/mock-interview/respond","/api/mock-interview/send-code","/api/mock-interview/run-code","/api/mock-interview/complete")){
  String id=UUID.randomUUID().toString().replace("-","");web.post().uri(route).header(RequestIds.HEADER,id).contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"p\",\"sessionId\":\"s\"}").exchange().expectStatus().isOk().expectHeader().valueEquals(RequestIds.HEADER,id).expectBody().consumeWith(r->assertThat(new String(r.getResponseBody())).isEqualTo("{ \"ok\": true, \"fixture\": true }"));
  awaitAudit(id);assertThat(jdbc.queryForObject("SELECT outcome FROM bff.ai_runs WHERE request_id=?",String.class,id)).isEqualTo("success");}
  web.post().uri("/api/coach/chat").contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"p\",\"agentFault\":true}").exchange().expectStatus().isEqualTo(422).expectHeader().valueEquals("X-Failure-Source","agent").expectBody().json("{\"ok\":false,\"error\":\"agent unchanged\"}");
 }
 @Test @Order(2) void lockAndQuotaDoNotDispatch(){var guard=app.getBean(RedisRequestGuard.class);String key=RedisRequestGuard.scopeKey("review",new ObjectMapper().valueToTree(Map.of("problemId","busy")),new BffProperties().namespace());assertThat(guard.acquire(key,"held",195).block()).isTrue();int count=calls.get();
  web.post().uri("/api/coach/chat").contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"busy\"}").exchange().expectStatus().isEqualTo(409).expectBody().jsonPath("$.code").isEqualTo("AI_BUSY");assertThat(calls.get()).isEqualTo(count);guard.release(key,"held").block();
  for(int i=0;i<30;i++)guard.rate("runner").block();web.post().uri("/api/workbench/run").contentType(MediaType.APPLICATION_JSON).bodyValue("{}").exchange().expectStatus().isEqualTo(429).expectHeader().exists("Retry-After");assertThat(calls.get()).isEqualTo(count);
 }
 @Test @Order(2) void realBulkheadAndMarkerLossWithoutRedispatch(){
  int before=calls.get();var first=org.springframework.web.reactive.function.client.WebClient.create("http://127.0.0.1:"+app.getWebServer().getPort()).post().uri("/api/coach/chat").contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"holding\",\"stallJson\":true}").retrieve().bodyToMono(String.class).toFuture();
  for(int i=0;i<100&&calls.get()==before;i++){try{Thread.sleep(10);}catch(InterruptedException x){Thread.currentThread().interrupt();throw new RuntimeException(x);}}
  web.post().uri("/api/coach/chat").contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"other\"}").exchange().expectStatus().isEqualTo(503).expectBody().jsonPath("$.code").isEqualTo("BULKHEAD_FULL");assertThat(calls.get()).isEqualTo(before+1);first.join();
  var guard=app.getBean(RedisRequestGuard.class);String key=RedisRequestGuard.scopeKey("review",new ObjectMapper().valueToTree(Map.of("problemId","lost")),new BffProperties().namespace());assertThat(guard.acquire(key,"old",195).block()).isTrue();app.getBean(RedissonClient.class).getBucket(key).delete();int count=calls.get();assertThat(guard.acquire(key,"new",195).block()).isTrue();assertThat(calls.get()).isEqualTo(count);assertThat(guard.release(key,"old").block()).isZero();guard.release(key,"new").block();
 }
 @Test @Order(3) void streamedTerminalProtocolErrorAndTimeout(){
  web.post().uri("/api/coach/review").accept(MediaType.TEXT_EVENT_STREAM,MediaType.valueOf("application/x-ndjson")).contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"stream\"}").exchange().expectStatus().isOk().expectHeader().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM).expectBody().consumeWith(r->{String body=new String(r.getResponseBody());assertThat(body).contains("event: evidence","event: complete").doesNotContain("late","bff_error");});
  web.post().uri("/api/coach/review").accept(MediaType.TEXT_EVENT_STREAM).contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"bad\",\"badStream\":true}").exchange().expectStatus().isOk().expectBody().consumeWith(r->assertThat(new String(r.getResponseBody())).contains("event: bff_error","UPSTREAM_PROTOCOL_ERROR"));
  String id="c".repeat(32);web.post().uri("/api/coach/review").header(RequestIds.HEADER,id).accept(MediaType.TEXT_EVENT_STREAM).contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"stall\",\"stall\":true}").exchange().expectStatus().isOk().expectBody().consumeWith(r->assertThat(new String(r.getResponseBody())).contains("TIMEOUT","\"status\":504"));awaitAudit(id);assertThat(jdbc.queryForObject("SELECT outcome FROM bff.ai_runs WHERE request_id=?",String.class,id)).isEqualTo("bff_timeout");
  int count=calls.get();web.post().uri("/api/coach/review").contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"circuit\"}").exchange().expectStatus().isEqualTo(503).expectBody().jsonPath("$.code").isEqualTo("CIRCUIT_OPEN");assertThat(calls.get()).isEqualTo(count);
 }
 @Test @Order(4) void internalAuthIsBffFailure(){web.post().uri("/api/coach/chat").contentType(MediaType.APPLICATION_JSON).bodyValue("{\"problemId\":\"auth\",\"authFault\":true}").exchange().expectStatus().isEqualTo(503).expectHeader().valueEquals("X-Failure-Source","bff").expectHeader().doesNotExist("X-Coach-Proxy-Error").expectBody().jsonPath("$.code").isEqualTo("UPSTREAM_AUTH_FAILED");}
 @Test @Order(5) void actualServiceLossKeepsLivenessAndFailsClosed(){web.get().uri("/actuator/health/readiness").exchange().expectStatus().isOk();redis.stop();web.get().uri("/actuator/health/liveness").exchange().expectStatus().isOk();web.get().uri("/actuator/health/readiness").exchange().expectStatus().isEqualTo(503);
  int before=calls.get();web.post().uri("/api/workbench/run").contentType(MediaType.APPLICATION_JSON).bodyValue("{}").exchange().expectStatus().isEqualTo(503).expectBody().jsonPath("$.code").isEqualTo("REDIS_UNAVAILABLE");assertThat(calls.get()).isEqualTo(before);
  pg.stop();web.get().uri("/actuator/health/liveness").exchange().expectStatus().isOk();web.get().uri("/actuator/health/readiness").exchange().expectStatus().isEqualTo(503);web.post().uri("/api/workbench/run").contentType(MediaType.APPLICATION_JSON).bodyValue("{}").exchange().expectStatus().isEqualTo(503).expectBody().jsonPath("$.code").isEqualTo("AUDIT_UNAVAILABLE");assertThat(calls.get()).isEqualTo(before);
 }
 static void awaitAudit(String id){for(int i=0;i<100;i++){Integer n=jdbc.queryForObject("SELECT count(*) FROM bff.ai_runs WHERE request_id=? AND finished_at IS NOT NULL",Integer.class,id);if(n!=null&&n==1)return;try{Thread.sleep(10);}catch(InterruptedException x){Thread.currentThread().interrupt();throw new RuntimeException(x);}}throw new AssertionError("Audit completion missing");}
}
