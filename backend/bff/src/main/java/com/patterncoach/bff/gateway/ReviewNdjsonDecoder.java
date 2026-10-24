package com.patterncoach.bff.gateway;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.buffer.*;
import reactor.core.publisher.Flux;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.function.Consumer;
public final class ReviewNdjsonDecoder {
 private final ObjectMapper mapper;private final int maxLine,maxTotal;private final Runnable anomaly;private final Consumer<String> terminal;
 private final ByteArrayOutputStream line=new ByteArrayOutputStream();private int total;private boolean evidence,done;
 public ReviewNdjsonDecoder(ObjectMapper mapper,int maxLine,int maxTotal,Runnable anomaly,Consumer<String> terminal){this.mapper=mapper;this.maxLine=maxLine;this.maxTotal=maxTotal;this.anomaly=anomaly;this.terminal=terminal;}
 public boolean terminalSeen(){return done;}
 public Flux<String> decode(Flux<DataBuffer> source){return source.concatMap(buffer -> Flux.<String>create(sink -> {
  try{while(buffer.readableByteCount()>0){byte next=buffer.read();if(done){anomaly.run();buffer.readPosition(buffer.writePosition());break;}if(++total>maxTotal)throw invalid();
   if(next==10){String frame=parse();if(frame!=null)sink.next(frame);}else{if(line.size()>=maxLine)throw invalid();line.write(next);}}
  sink.complete();}catch(Exception error){sink.error(error);}finally{DataBufferUtils.release(buffer);}
 })).concatWith(Flux.defer(() -> {if(done)return Flux.empty();String frame=line.size()>0?parse():null;if(!done)return Flux.error(invalid());return frame==null?Flux.empty():Flux.just(frame);}));}
 private String parse(){
  byte[] bytes=line.toByteArray();line.reset();int length=bytes.length;if(length>0&&bytes[length-1]==13)length--;
  try{String raw=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes,0,length)).toString();if(raw.isBlank())return null;
   var node=mapper.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(raw);String type=node.path("type").asText();switch(type){
    case "evidence" -> {if(evidence||!node.path("evidence").isObject())throw invalid();evidence=true;}
    case "complete" -> {if(!node.path("result").isObject())throw invalid();done=true;terminal.accept(type);}
    case "error" -> {if(!node.path("error").isTextual())throw invalid();done=true;terminal.accept(type);}
    default -> throw invalid();
   }return "event: "+type+"\ndata: "+raw+"\n\n";
  }catch(Exception e){throw invalid();}
 }
 private IllegalStateException invalid(){return new IllegalStateException("UPSTREAM_PROTOCOL_ERROR");}
}
