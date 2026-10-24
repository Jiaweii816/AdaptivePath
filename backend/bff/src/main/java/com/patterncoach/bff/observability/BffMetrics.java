package com.patterncoach.bff.observability;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import java.util.concurrent.TimeUnit;
@Component
public class BffMetrics {
    private final MeterRegistry registry;
    public BffMetrics(MeterRegistry registry) { this.registry=registry; }
    public void auditFailure(String phase) { registry.counter("bff.audit.failures", "phase", phase).increment(); }
    public void finished(String route, String outcome, long nanos) {
        registry.timer("bff.requests", "route", route, "outcome", outcome).record(nanos, TimeUnit.NANOSECONDS);
    }
}
