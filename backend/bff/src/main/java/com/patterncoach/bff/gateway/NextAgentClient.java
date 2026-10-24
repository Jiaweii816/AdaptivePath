package com.patterncoach.bff.gateway;
import com.patterncoach.bff.config.BffProperties;
import com.patterncoach.bff.web.RequestIds;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.http.*;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import io.netty.channel.ChannelOption;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
@Component
public class NextAgentClient {
 private final WebClient client;
 public NextAgentClient(BffProperties properties) {
  client=WebClient.builder().baseUrl(properties.getNextBaseUrl())
   .defaultHeader("X-Coach-Internal-Token",properties.getInternalToken())
   .clientConnector(new ReactorClientHttpConnector(HttpClient.create().disableRetry(true).option(ChannelOption.CONNECT_TIMEOUT_MILLIS,3000)))
   .codecs(c -> c.defaultCodecs().maxInMemorySize(properties.getJsonBytes())).build();
 }
 public WebClient.RequestHeadersSpec<?> request(String path, byte[] body,String requestId,String accept) {
  return client.post().uri(path).header(RequestIds.HEADER,requestId).contentType(MediaType.APPLICATION_JSON).header(HttpHeaders.ACCEPT,accept).bodyValue(body);
 }
 public Mono<Reply> json(String path,byte[] body,String requestId) {
  return request(path,body,requestId,"application/json").exchangeToMono(response ->
   response.bodyToMono(byte[].class).onErrorMap(org.springframework.core.io.buffer.DataBufferLimitException.class,x->new IllegalStateException("UPSTREAM_PROTOCOL_ERROR")).defaultIfEmpty(new byte[0]).map(bytes -> new Reply(response.statusCode().value(),bytes,response.headers().contentType().orElse(MediaType.APPLICATION_JSON),response.headers().header("X-Coach-Proxy-Error").contains("INTERNAL_TOKEN_INVALID"))));
 }
 public record Reply(int status,byte[] body,MediaType contentType,boolean internalAuthFailure) {}
}
