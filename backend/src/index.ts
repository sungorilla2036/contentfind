import { verify } from 'jsonwebtoken';

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
interface SupabaseJWTPayload {
	sub: string;
	aud: string;
	exp: number;
	iat: number;
	email: string;
	phone: string;
	app_metadata: {
		provider: string;
		providers: string[];
	};
	user_metadata: {
		sub: string;
		iss: string;
		picture: string;
		name: string;

		nickname?: string;
		phone_verified?: boolean;
		email?: string;
		email_verified?: boolean;

		// deprecated
		slug?: string;
		avatar_url?: string;
		full_name?: string;
		provider_id?: string;
	};
	role: string;
	aal: string;
	amr: {
		method: string;
		timestamp: number;
	}[];
	session_id: string;
	is_anonymous: boolean;
}

function uuidToBigint(uuid: string) {
	return BigInt(`0x${uuid.replace(/-/g, '')}`);
}

// Function to select the appropriate D1 database based on platform
function getClipsDb(platform: string, env: Env) {
	switch (platform.toLowerCase()) {
		case 'youtube':
			return env.CF_YOUTUBE_CLIPS;
		case 'twitch':
			return env.CF_TWITCH_CLIPS;
		default:
			throw new Error('Unsupported platform');
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Handle CORS preflight requests
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Authorization, Content-Type',
				},
			});
		}

		if (request.method === 'POST' && new URL(request.url).pathname === '/jobs') {
			try {
				const authHeader = request.headers.get('Authorization');
				if (!authHeader) {
					return new Response('Unauthorized', {
						status: 401,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				const token = authHeader.split(' ')[1];
				const decoded = verify(token, env.jwt_secret) as SupabaseJWTPayload;

				// Check if expired
				if (decoded.exp < Date.now() / 1000) {
					return new Response('Unauthorized', {
						status: 401,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				const usersDb = env.CF_USERS;
				const indexJobsDb = env.CF_INDEX_JOBS;
				const transcriptionJobsDb = env.CF_TRANSCRIPTION_JOBS;

				// Rate limiting logic
				const userID = uuidToBigint(decoded.sub).toString();
				interface User {
					uuid: string;
					last_request: number;
					is_premium: boolean;
					credits: number;
				}

				let user = (await usersDb.prepare(`SELECT * FROM users WHERE uuid = ${userID}`).first()) as User;
				if (!user) {
					// Create user
					await usersDb
						.prepare(`INSERT INTO users (uuid, last_request, is_premium, credits, identities) VALUES (${userID}, ?, ?, ?, ?)`)
						.bind(
							0,
							false,
							60,
							JSON.stringify([
								[
									decoded.user_metadata.iss,
									decoded.sub,
									decoded.user_metadata.picture,
									decoded.user_metadata.name,
									decoded.user_metadata.nickname || '',
								],
							])
						)
						.run();
					user = {
						uuid: userID,
						last_request: 0,
						is_premium: false,
						credits: 60,
					};
				}
				const currentTime = Math.round(Date.now() / 1000);
				const lastRequestTime = user.last_request as number;
				const isPremium = user.is_premium;
				const rateLimit = isPremium ? 60 : 24 * 60 * 60; // 1 minute or 1 day

				if (currentTime - lastRequestTime < rateLimit) {
					const timeRemaining = rateLimit - (currentTime - lastRequestTime);
					const hours = Math.ceil(timeRemaining / 3600);

					const message = isPremium
						? `Premium users can make 1 request per minute.`
						: `Free users can make 1 request per day. Please wait ${hours} hour(s).`;

					return new Response(message, {
						status: 429,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				const { platform_id, channel_id, content_id } = (await request.json()) as {
					platform_id: string;
					channel_id: string;
					content_id?: string;
				};

				// [transcription_jobs Only] Verify user has sufficient credits
				if (content_id) {
					// TODO get content duration and calculate credits required
					if (user.credits < 1) {
						return new Response('Insufficient credits', {
							status: 403,
							headers: {
								'Access-Control-Allow-Origin': '*',
							},
						});
					}
				}

				// Verify job is not already queued or running and last completed time falls within rate limit
				let jobDb;
				let conflictFields;
				if (content_id) {
					jobDb = transcriptionJobsDb;
					conflictFields = '(platform_id, content_id)';
				} else {
					jobDb = indexJobsDb;
					conflictFields = '(platform_id, channel_id)';
				}

				const existingJob = await jobDb
					.prepare(
						`SELECT * FROM ${content_id ? 'transcription_jobs' : 'indexer_jobs'} WHERE platform_id = ? AND channel_id = ?${
							content_id ? ' AND content_id = ?' : ''
						}`
					)
					.bind(platform_id, channel_id, ...(content_id ? [content_id] : []))
					.first();

				if (existingJob && [0, 1, 2].includes(existingJob.job_state as number)) {
					return new Response('Job is already queued or running', {
						status: 409,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				if (jobDb === indexJobsDb && existingJob && (existingJob.last_completed as number) > currentTime - 7 * 24 * 60 * 60) {
					return new Response('Job was completed recently', {
						status: 429,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				// Create or update job in database
				await jobDb
					.prepare(
						`
					INSERT INTO ${content_id ? 'transcription_jobs' : 'indexer_jobs'} (platform_id, channel_id${
							content_id ? ', content_id' : ''
						}, job_state, queued)
					VALUES (${content_id ? '?, ?, ?' : '?, ?'}, 0, ?)
					ON CONFLICT ${conflictFields}
					DO UPDATE SET job_state = 0, queued = ?
				`
					)
					.bind(platform_id, channel_id, ...(content_id ? [content_id] : []), currentTime, currentTime)
					.run();

				// Update user last request time
				await usersDb.prepare(`UPDATE users SET last_request = ? WHERE uuid = ${userID}`).bind(currentTime).run();

				return new Response('Job created successfully', {
					status: 201,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (error) {
				console.error(error);
				return new Response('Error processing job', {
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				});
			}
		}

		// Add GET /jobs route
		if (request.method === 'GET' && new URL(request.url).pathname === '/jobs') {
			try {
				const url = new URL(request.url);
				const platform_id = url.searchParams.get('platform_id');
				const content_id = url.searchParams.get('content_id');
				const channel_id = url.searchParams.get('channel_id');

				if (!platform_id || !(content_id || channel_id)) {
					return new Response('Unauthorized', {
						status: 401,
						headers: { 'Access-Control-Allow-Origin': '*' },
					});
				}

				let jobDb;
				let query;
				let params: any[] = [platform_id];

				if (content_id) {
					jobDb = env.CF_TRANSCRIPTION_JOBS;
					query = 'SELECT * FROM transcription_jobs WHERE platform_id = ? AND content_id = ?';
					params.push(content_id);
				} else {
					jobDb = env.CF_INDEX_JOBS;
					query = 'SELECT * FROM indexer_jobs WHERE platform_id = ? AND channel_id = ?';
					params.push(channel_id);
				}

				const job = await jobDb
					.prepare(query)
					.bind(...params)
					.first();

				if (!job) {
					return new Response('[]', {
						status: 200,
						headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
					});
				}

				const responseData: any = { state: job.job_state };

				if (job.job_state === 0) {
					// Assuming 0 represents 'queued'
					const countResult = await jobDb
						.prepare(
							`SELECT COUNT(*) as count FROM ${
								content_id ? 'transcription_jobs' : 'indexer_jobs'
							} WHERE platform_id = ? AND job_state = 0 AND queued < ?`
						)
						.bind(platform_id, job.queued)
						.first();
					responseData.pos = (countResult?.count as number) + 1;
				}

				return new Response(JSON.stringify([responseData]), {
					status: 200,
					headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
				});
			} catch (error) {
				console.error(error);
				return new Response('Error fetching job status', {
					status: 400,
					headers: { 'Access-Control-Allow-Origin': '*' },
				});
			}
		}

		if (request.method === 'POST' && new URL(request.url).pathname === '/clips') {
			try {
				const authHeader = request.headers.get('Authorization');
				if (!authHeader) {
					return new Response('Unauthorized', {
						status: 401,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				const token = authHeader.split(' ')[1];
				const decoded = verify(token, env.jwt_secret) as SupabaseJWTPayload;

				// Check if expired
				if (decoded.exp < Date.now() / 1000) {
					return new Response('Unauthorized', {
						status: 401,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				const userID = uuidToBigint(decoded.sub).toString();

				const { platform, channel_id, content_id, start_time, duration, title } = (await request.json()) as {
					platform: string;
					channel_id: string;
					content_id: string;
					start_time: number;
					duration: number;
					title?: string;
				};

				const clipsDb = getClipsDb(platform, env);

				await clipsDb
					.prepare(
						`
					INSERT INTO clips (channel_id, content_id, start_time, duration, title, user_id)
					VALUES (?, ?, ?, ?, ?, ${userID})
				`
					)
					.bind(channel_id, content_id, start_time, duration, title || '')
					.run();

				return new Response('Clip created successfully', {
					status: 201,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (error) {
				console.error(error);
				return new Response('Error creating clip', {
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				});
			}
		}

		if (request.method === 'GET' && /^\/videos\/[^\/]+\/clips$/.test(new URL(request.url).pathname)) {
			try {
				const url = new URL(request.url);
				const segments = url.pathname.split('/');
				const videoId = segments[2];
				const platform = url.searchParams.get('platform');

				if (!platform) {
					return new Response('Platform query parameter is required', {
						status: 400,
						headers: {
							'Access-Control-Allow-Origin': '*',
						},
					});
				}

				const clipsDb = getClipsDb(platform, env);

				const clips = await clipsDb
					.prepare(
						`
					SELECT * FROM clips WHERE content_id = ?
				`
					)
					.bind(videoId)
					.all();

				return new Response(JSON.stringify(clips.results), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*',
					},
				});
			} catch (error) {
				console.error(error);
				return new Response('Error fetching clips', {
					status: 400,
					headers: {
						'Access-Control-Allow-Origin': '*',
					},
				});
			}
		}

		return new Response('Not found', {
			status: 404,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
		});
	},
} satisfies ExportedHandler<Env>;
