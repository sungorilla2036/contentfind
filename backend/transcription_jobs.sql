CREATE TABLE transcription_jobs (
    platform_id INT,
    channel_id VARCHAR(255),
    content_id VARCHAR(255),
    build_index BOOLEAN,
    job_state INT, -- queued=0, running=1, completed=2, failed=3
    last_completed DATETIME,
    queued DATETIME,
    PRIMARY KEY (platform_id, channel_id, content_id)
);

CREATE INDEX idx_transcription_job_state_queued ON transcription_jobs(job_state, queued);
