package com.patterncoach.bff;
import com.patterncoach.bff.gateway.*;
import com.patterncoach.bff.config.BffProperties;
import org.junit.jupiter.api.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import com.sun.net.httpserver.Headers;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class HeaderTrustTest {
 @Test void injectsOnlyServiceCredentialAndCorrelation() throws Exception {
  var seen=new AtomicReference<Headers>();var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/",x -> {seen.set(x.getRequestHeaders());x.getResponseHeaders().set("X-Coach-Proxy-Error","INTERNAL_TOKEN_INVALID");x.sendResponseHeaders(403,-1);x.close();});server.start();
  try{var p=new BffProperties();p.setInternalToken("test-only");p.setNextBaseUrl("http://127.0.0.1:"+server.getAddress().getPort());var reply=new NextAgentClient(p).json("/api/coach/chat","{}".getBytes(),"a".repeat(32)).block(Duration.ofSeconds(5));assertThat(reply.internalAuthFailure()).isTrue();assertThat(seen.get().getFirst("X-Coach-Internal-Token")).isEqualTo("test-only");assertThat(seen.get().getFirst("X-Request-ID")).isEqualTo("a".repeat(32));assertThat(seen.get().getFirst("Authorization")).isNull();assertThat(seen.get().getFirst("Cookie")).isNull();}finally{server.stop(0);}
 }
}
