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

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method === 'POST' && new URL(request.url).pathname === '/jobs') {
			try {
				const authHeader = request.headers.get('Authorization');
				if (!authHeader) {
					return new Response('Unauthorized', { status: 401 });
				}

				const token = authHeader.split(' ')[1];
				const decoded = verify(token, env.jwt_secret) as SupabaseJWTPayload;

				// Check if expired
				if (decoded.exp < Date.now() / 1000) {
					return new Response('Unauthorized', { status: 401 });
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
					return new Response('Rate limit exceeded', { status: 429 });
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
						return new Response('Insufficient credits', { status: 403 });
					}
				}

				// Verify job is not already queued or running and last completed time falls within rate limit
				let jobDb;
				let conflictFields;
				if (content_id) {
					jobDb = transcriptionJobsDb;
					conflictFields = '(platform_id, channel_id, content_id)';
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

				if (existingJob && [0, 1].includes(existingJob.job_state as number)) {
					return new Response('Job is already queued or running', { status: 400 });
				}

				if (jobDb === indexJobsDb && existingJob && (existingJob.last_completed as number) > currentTime - 7 * 24 * 60 * 60) {
					return new Response('Job was completed recently', { status: 400 });
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

				return new Response('Job created successfully', { status: 201 });
			} catch (error) {
				console.error(error);
				return new Response('Error processing job', { status: 400 });
			}
		}
		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
