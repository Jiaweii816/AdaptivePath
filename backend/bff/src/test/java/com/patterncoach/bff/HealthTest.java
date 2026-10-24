package com.patterncoach.bff;
import com.patterncoach.bff.config.BffProperties;
import com.patterncoach.bff.health.BffReadinessHealthIndicator;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.boot.actuate.health.Status;
import org.flywaydb.core.Flyway;
import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class HealthTest {
 @Test void missingSecretIsStartupFailure() {assertThatThrownBy(() -> new BffProperties().afterPropertiesSet()).isInstanceOf(IllegalStateException.class);}
 @Test void dependencyFailureIsReadinessDown() {var p=new BffProperties();p.setInternalToken("test");assertThat(new BffReadinessHealthIndicator(mock(JdbcTemplate.class),mock(Flyway.class),p,mock(com.patterncoach.bff.gateway.RedisRequestGuard.class)).health().getStatus()).isEqualTo(Status.DOWN);}
 @Test void livenessIsProcessOnly() throws Exception {try(var in=getClass().getResourceAsStream("/application.yml")){assertThat(new String(in.readAllBytes())).contains("include: livenessState").doesNotContain("livenessState,bffReadiness");}}
}
