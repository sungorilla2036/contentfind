# Tables
## Search Indexer Jobs

| Field          | Type    |
|----------------|---------|
| platformID     | int     |
| channelID      | string  |
| status         | int (queued, running, completed, failed) |
| lastCompleted  | dateTime|
| queued         | dateTime|

## Transcription Jobs

| Field          | Type    |
|----------------|---------|
| platformID     | int     |
| channelID      | string  |
| contentID      | string  |
| buildIndex     | boolean |
| status         | int (queued, running, completed, failed) |
| lastCompleted  | dateTime|
| queued         | dateTime|

## Users

| Field  | Type |
|--------|------|
| user   | uuid (blob) |
| identities | text |
| credits| int  |
| lastRequest | dateTime |
| isPremium | boolean |

## Channels

| Field      | Type   |
|------------|--------|
| platformID | int    |
| channelID  | string |
| credits    | int    |

# Routes
## POST /jobs
### Payload
- Auth header includes jwt with user info
- platformID
- channelID
- contentID (optional)

### Behavior
1. Verify jwt
2. Verify user last request time within rate limit (1/day for free users, 1/minute for premium)
3. [Transcription Jobs Only] Verify user has sufficient credits
4. Verify job is not already queued or running and last completed time falls within rate limit (1/week)
5. Create or update job in database
6. Update user last request time
