package com.patterncoach.bff;
import com.patterncoach.bff.audit.*;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.time.Duration;
import static org.assertj.core.api.Assertions.*;
@Timeout(60)
class AuditPostgresIT {
 @Test void isolatedFlywayAndAuditLifecycle() {
  try(var pg=new PostgreSQLContainer<>("postgres:16-alpine").withStartupTimeout(Duration.ofSeconds(40))) {
   pg.start();var ds=new DriverManagerDataSource(pg.getJdbcUrl(),pg.getUsername(),pg.getPassword());
   var flyway=Flyway.configure().dataSource(ds).schemas("bff").defaultSchema("bff").load();flyway.migrate();flyway.validate();
   var jdbc=new JdbcTemplate(ds);var repo=new AiRunAuditRepository(jdbc);
   try {var a=new AiRunAudit("a".repeat(32),"/api/coach/chat","POST");repo.insert(a).block(Duration.ofSeconds(3));a.result("success",null,null);repo.finish(a,200).block(Duration.ofSeconds(3));a.result("bff_timeout","bff","TIMEOUT");repo.finish(a,504).block(Duration.ofSeconds(3));
    assertThat(jdbc.queryForObject("SELECT outcome FROM bff.ai_runs",String.class)).isEqualTo("success");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM bff.ai_runs",Integer.class)).isEqualTo(1);
    assertThat(jdbc.queryForList("SELECT tablename FROM pg_tables WHERE schemaname='bff'",String.class)).containsExactlyInAnyOrder("ai_runs","flyway_schema_history");
    assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema='bff' AND table_name='ai_runs'",Integer.class)).isEqualTo(12);
   } finally {repo.close();}
  }
 }
}
