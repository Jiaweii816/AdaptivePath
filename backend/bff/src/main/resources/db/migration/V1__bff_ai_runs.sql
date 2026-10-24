CREATE TABLE bff.ai_runs (
 id uuid PRIMARY KEY,
 request_id varchar(32) NOT NULL,
 route varchar(100) NOT NULL,
 method varchar(16) NOT NULL,
 started_at timestamptz NOT NULL,
 finished_at timestamptz,
 duration_ms bigint,
 http_status smallint,
 upstream_status smallint,
 outcome text CHECK (outcome IN ('success','agent_error','bff_rejected','bff_timeout','bff_upstream_error','client_disconnected')),
 error_source text CHECK (error_source IN ('bff','agent','client')),
 error_code varchar(64)
);
CREATE INDEX ai_runs_request_id ON bff.ai_runs(request_id);
