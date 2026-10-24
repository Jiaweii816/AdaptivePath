package com.patterncoach.bff;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.web.*;
import com.patterncoach.bff.config.BffProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.test.web.reactive.server.WebTestClient;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class JsonGatewayTest {
 @Test void preservesJsonForEveryRouteAndDoesNotForwardUnknownPaths() throws Exception {
  var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/",x -> {byte[] bytes=x.getRequestBody().readAllBytes();x.getResponseHeaders().set("Content-Type","application/json");x.sendResponseHeaders(422,bytes.length);x.getResponseBody().write(bytes);x.close();});server.start();
  try {var p=new BffProperties();p.setInternalToken("test");p.setNextBaseUrl("http://127.0.0.1:"+server.getAddress().getPort());
   var c=WebTestClient.bindToWebHandler(e -> e.getResponse().setComplete()).webFilter(new RequestIdFilter(),new JsonGatewayController(new NextAgentClient(p),new ObjectMapper(),p)).configureClient().responseTimeout(Duration.ofSeconds(5)).build();
   for(String path:new String[]{"/api/coach/review","/api/coach/chat","/api/coach/chat/clear","/api/workbench/run","/api/mock-interview/start","/api/mock-interview/respond","/api/mock-interview/send-code","/api/mock-interview/run-code","/api/mock-interview/complete"}) {
    byte[] body="{ \"ok\": false, \"error\": \"agent error\", \"extra\": 7 }".getBytes();c.post().uri(path).bodyValue(body).exchange().expectStatus().isEqualTo(422).expectHeader().valueEquals("X-Failure-Source","agent").expectBody().consumeWith(result -> assertThat(result.getResponseBody()).isEqualTo(body));
   }
   c.get().uri("/api/coach/chat").exchange().expectStatus().isEqualTo(405);
   c.post().uri("/api/planner/start").exchange().expectStatus().isNotFound();
   c.post().uri("/api/coach/chat").bodyValue("not JSON").exchange().expectStatus().isBadRequest();
  }finally{server.stop(0);}
 }
}
