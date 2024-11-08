# Tables
## indexer_jobs

| Field          | Type                                           |
|----------------|------------------------------------------------|
| platform_id    | int                                            |
| channel_id     | string                                         |
| job_state      | int (queued, running, content_uploaded, completed, failed) |
| last_completed | dateTime                                       |
| queued         | dateTime                                       |

## transcription_jobs

| Field          | Type                                           |
|----------------|------------------------------------------------|
| platform_id    | int                                            |
| channel_id     | string                                         |
| content_id     | string                                         |
| build_index    | boolean                                        |
| job_state      | int (queued, running, content_uploaded, completed, failed) |
| last_completed | dateTime                                       |
| queued         | dateTime                                       |

## users

| Field        | Type          |
|--------------|---------------|
| uuid         | uuid (blob)    |
| identities   | text          |
| credits      | int           |
| last_request | dateTime      |
| is_premium   | boolean       |

## channels

| Field       | Type   |
|-------------|--------|
| platform_id | int    |
| channel_id  | string |
| credits     | int    |

## clips

| Field       | Type   |
|-------------|--------|
| channel_id  | string |
| content_id  | string |
| start_time  | int    |
| duration    | int    |
| text        | text   |
| user_id     | uuid   |

# Routes
## POST /jobs
### Payload
- Auth header includes jwt with user info
- platform_id
- channel_id
- content_id (optional)

### Behavior
1. Verify jwt
2. Verify user last request time within rate limit (1/day for free users, 1/minute for premium)
3. [transcription jobs only] Verify user has sufficient credits
4. Verify job is not already queued, downloading, or running and last completed time falls within rate limit (1/week)
5. Create or update job in database with `queued` state
6. Update user last request time
