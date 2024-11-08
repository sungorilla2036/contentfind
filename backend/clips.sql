CREATE TABLE IF NOT EXISTS clips (
    channel_id TEXT NOT NULL,
    content_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    title TEXT,
    user_id BLOB NOT NULL,
    PRIMARY KEY (content_id, start_time, duration)
);
