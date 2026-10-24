package com.patterncoach.bff;
import com.patterncoach.bff.gateway.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.core.io.buffer.*;
import reactor.core.publisher.*;
import reactor.test.StepVerifier;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class ReviewStreamTest {
 private DataBuffer buffer(String value){return new DefaultDataBufferFactory().wrap(value.getBytes(StandardCharsets.UTF_8));}
 private ReviewNdjsonDecoder decoder(){return new ReviewNdjsonDecoder(new ObjectMapper(),1024,4096,()->{},type->{});}
 @Test void terminalIsImmediateAndContentIsExact(){
  String raw="{ \"type\": \"complete\", \"result\": {\"ok\":true,\"text\":\"你好\"} }";
  var source=Flux.concat(Flux.just(buffer(raw+"\n")),Flux.<DataBuffer>never());
  StepVerifier.create(decoder().decode(source)).expectNext("event: complete\ndata: "+raw+"\n\n").thenCancel().verify(Duration.ofSeconds(3));
 }
 @Test void lateDataOnlyCountsAnomaly(){var count=new AtomicInteger();var d=new ReviewNdjsonDecoder(new ObjectMapper(),1024,4096,count::incrementAndGet,type->{});
  var frames=d.decode(Flux.just(buffer("{\"type\":\"error\",\"error\":\"agent\"}\n"),buffer("invalid trailing"))).collectList().block();assertThat(frames).hasSize(1);assertThat(count.get()).isEqualTo(1);}
 @Test void splitUtf8AndUnterminatedFinalLine(){byte[] raw="{\"type\":\"complete\",\"result\":{\"text\":\"你好\"}}".getBytes(StandardCharsets.UTF_8);var factory=new DefaultDataBufferFactory();
  var pieces=Flux.range(0,raw.length).map(i -> (DataBuffer)factory.wrap(new byte[]{raw[i]}));assertThat(decoder().decode(pieces).collectList().block()).hasSize(1);}
 @Test void missingTerminalMalformedAndOversizeFail(){for(String data:new String[]{"", "{\"type\":\"evidence\",\"evidence\":{}}\n", "bad\n", "{\"type\":\"complete\",\"result\":{}} bad\n", "x".repeat(1025)}){
  StepVerifier.create(decoder().decode(Flux.just(buffer(data)))).thenConsumeWhile(x->true).expectErrorMessage("UPSTREAM_PROTOCOL_ERROR").verify(Duration.ofSeconds(3));}}
 @Test void preservesEvidenceAndEarlyError(){var frames=decoder().decode(Flux.just(buffer("{\"type\":\"evidence\",\"evidence\":{}}\n{\"type\":\"error\",\"error\":\"failed\"}\n"))).collectList().block();assertThat(frames).hasSize(2);assertThat(frames.get(1)).startsWith("event: error");}
}
