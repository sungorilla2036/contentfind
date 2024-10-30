CREATE TABLE channels (
    platform_id INT,
    channel_id VARCHAR(255),
    credits INT,
    PRIMARY KEY (platform_id, channel_id)
);
