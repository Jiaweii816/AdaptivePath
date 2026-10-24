package com.patterncoach.bff.audit;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Scheduler;
import reactor.core.scheduler.Schedulers;
import jakarta.annotation.PreDestroy;
import java.sql.Timestamp;
import java.time.Instant;
@Repository
public class AiRunAuditRepository {
    private final JdbcTemplate jdbc;
    private final Scheduler scheduler = Schedulers.newBoundedElastic(4, 64, "bff-audit");
    public AiRunAuditRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; jdbc.setQueryTimeout(2); }
    public Mono<AiRunAudit> insert(AiRunAudit audit) {
        return Mono.fromCallable(() -> {
            jdbc.update("INSERT INTO bff.ai_runs(id,request_id,route,method,started_at) VALUES (?,?,?,?,?)",
                audit.id,audit.requestId,audit.route,audit.method,Timestamp.from(audit.startedAt));
            return audit;
        }).subscribeOn(scheduler);
    }
    public Mono<Void> finish(AiRunAudit audit, int status) {
        return Mono.fromRunnable(() -> jdbc.update("""
            UPDATE bff.ai_runs SET finished_at=?,duration_ms=?,http_status=?,upstream_status=?,outcome=?,error_source=?,error_code=?
            WHERE id=? AND finished_at IS NULL
            """, Timestamp.from(Instant.now()),(System.nanoTime()-audit.startedNanos)/1_000_000,status,
            audit.upstreamStatus,audit.outcome,audit.errorSource,audit.errorCode,audit.id)).subscribeOn(scheduler).then();
    }
    @PreDestroy public void close() { scheduler.dispose(); }
}
