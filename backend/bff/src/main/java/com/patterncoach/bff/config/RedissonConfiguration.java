package com.patterncoach.bff.config;
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;
import org.springframework.context.annotation.*;
/** Gate A D6: configuration copied; local address, bounded timeout and retries adapted. */
@Configuration
public class RedissonConfiguration {
 @Bean(destroyMethod="shutdown") public RedissonClient redissonClient(BffProperties p){return create(p.getRedisAddress());}
 public static RedissonClient create(String address){
  Config config=new Config();config.setThreads(2).setNettyThreads(2).setLazyInitialization(true);
  config.useSingleServer().setAddress(address).setConnectionMinimumIdleSize(1).setConnectionPoolSize(4).setConnectTimeout(1000).setTimeout(1000).setRetryAttempts(0);
  return Redisson.create(config);
 }
}
