CREATE TABLE indexer_jobs (
    platform_id INT,
    channel_id VARCHAR(255),
    job_state INT, -- queued=0, running=1, completed=2, failed=3
    last_completed DATETIME,
    queued DATETIME,
    PRIMARY KEY (platform_id, channel_id)
);

CREATE INDEX idx_indexer_job_state_queued ON indexer_jobs(job_state, queued);
