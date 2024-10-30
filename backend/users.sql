CREATE TABLE users (
    uuid BLOB,
    identities TEXT,
    credits INT,
    last_request DATETIME,
    is_premium BOOLEAN,
    PRIMARY KEY (uuid)
);
