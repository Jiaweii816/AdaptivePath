package com.patterncoach.bff.health;
import org.springframework.boot.actuate.health.*;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import org.flywaydb.core.Flyway;
import com.patterncoach.bff.config.BffProperties;
@Component("bffReadiness")
public class BffReadinessHealthIndicator implements HealthIndicator {
    private final com.patterncoach.bff.gateway.RedisRequestGuard redis; private final JdbcTemplate jdbc; private final Flyway flyway; private final BffProperties properties;
    public BffReadinessHealthIndicator(JdbcTemplate jdbc,Flyway flyway,BffProperties properties,com.patterncoach.bff.gateway.RedisRequestGuard redis) {this.redis=redis;this.jdbc=jdbc;this.flyway=flyway;this.properties=properties;}
    public Health health() {
        try {
            if(properties.getInternalToken().isBlank() || flyway.info().pending().length!=0) return Health.down().build();
            jdbc.queryForObject("SELECT count(*) FROM bff.flyway_schema_history WHERE success",Integer.class);
            return Boolean.TRUE.equals(redis.ping().block(java.time.Duration.ofSeconds(1)))?Health.up().build():Health.down().build();
        } catch(Exception e) { return Health.down().build(); }
    }
}
