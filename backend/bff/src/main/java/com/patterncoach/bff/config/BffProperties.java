package com.patterncoach.bff.config;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.beans.factory.InitializingBean;
@ConfigurationProperties("bff")
public class BffProperties implements InitializingBean {
    private final java.util.Map<String,Policy> routes=new java.util.LinkedHashMap<>();
    private int circuitWindow=20, circuitMinimumCalls=10, circuitFailurePercent=50, circuitOpenSeconds=30, circuitHalfOpenCalls=2;
    private int requestBytes=4*1024*1024, jsonBytes=16*1024*1024, lineBytes=16*1024*1024, streamBytes=32*1024*1024;
    public BffProperties() {
        routes.put("review",new Policy(180,"review",2,"ai",10,true));routes.put("chat",new Policy(120,"chat",1,"ai",10,true));
        routes.put("clear",new Policy(15,"clear",1,"clear",30,true));routes.put("run",new Policy(60,"runner",2,"runner",30,false));
        for(String name:new String[]{"start","respond","send-code"})routes.put(name,new Policy(120,"interview",1,"ai",10,true));
        routes.put("run-code",new Policy(60,"runner",2,"runner",30,false));routes.put("complete",new Policy(180,"interview",1,"ai",10,true));
    }
    public java.util.Map<String,Policy> getRoutes(){return routes;}
    public static class Policy {
        private int deadlineSeconds,capacity,quota; private String group,rateGroup; private boolean lock;
        public Policy(){}
        public Policy(int seconds,String group,int capacity,String rateGroup,int quota,boolean lock){this.deadlineSeconds=seconds;this.group=group;this.capacity=capacity;this.rateGroup=rateGroup;this.quota=quota;this.lock=lock;}
        public int getDeadlineSeconds(){return deadlineSeconds;} public void setDeadlineSeconds(int v){deadlineSeconds=v;}
        public int getCapacity(){return capacity;}public void setCapacity(int v){capacity=v;}
        public int getQuota(){return quota;}public void setQuota(int v){quota=v;}
        public String getGroup(){return group;}public void setGroup(String v){group=v;}
        public String getRateGroup(){return rateGroup;}public void setRateGroup(String v){rateGroup=v;}
        public boolean isLock(){return lock;}public void setLock(boolean v){lock=v;}
    }
    public int getCircuitWindow(){return circuitWindow;} public void setCircuitWindow(int v){circuitWindow=v;}
    public int getCircuitMinimumCalls(){return circuitMinimumCalls;}public void setCircuitMinimumCalls(int v){circuitMinimumCalls=v;}
    public int getCircuitFailurePercent(){return circuitFailurePercent;}public void setCircuitFailurePercent(int v){circuitFailurePercent=v;}
    public int getCircuitOpenSeconds(){return circuitOpenSeconds;}public void setCircuitOpenSeconds(int v){circuitOpenSeconds=v;}
    public int getCircuitHalfOpenCalls(){return circuitHalfOpenCalls;}public void setCircuitHalfOpenCalls(int v){circuitHalfOpenCalls=v;}
    public int getRequestBytes(){return requestBytes;}public void setRequestBytes(int v){requestBytes=v;}
    public int getJsonBytes(){return jsonBytes;}public void setJsonBytes(int v){jsonBytes=v;}
    public int getLineBytes(){return lineBytes;}public void setLineBytes(int v){lineBytes=v;}
    public int getStreamBytes(){return streamBytes;}public void setStreamBytes(int v){streamBytes=v;}
    private String redisAddress="redis://redis:6379", environment="test", learner="round1-test";
    public String getRedisAddress(){return redisAddress;}public void setRedisAddress(String v){redisAddress=v;}
    public String getEnvironment(){return environment;}public void setEnvironment(String v){environment=v;}
    public String getLearner(){return learner;}public void setLearner(String v){learner=v;}
    public String namespace(){return "coach:r1:"+environment+":"+learner+":";}
    private String nextBaseUrl="http://next:3000";
    public String getNextBaseUrl(){return nextBaseUrl;}
    public void setNextBaseUrl(String value){nextBaseUrl=value;}
    private String internalToken = "";
    public String getInternalToken() { return internalToken; }
    public void setInternalToken(String value) { internalToken = value; }
    public void afterPropertiesSet() {
        if (internalToken == null || internalToken.isBlank()) throw new IllegalStateException("BFF_INTERNAL_TOKEN is required");
        if(!environment.matches("[a-zA-Z0-9_-]+")||!learner.matches("[a-zA-Z0-9_-]+"))throw new IllegalStateException("Invalid Redis namespace");
        for(var p:routes.values()) if(p.deadlineSeconds<1 || p.capacity<1 || p.quota<1) throw new IllegalStateException("Invalid route protection configuration");
    }
}
