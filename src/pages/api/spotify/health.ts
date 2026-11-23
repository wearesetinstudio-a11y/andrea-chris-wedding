import type { APIRoute } from 'astro';

export const prerender = false;

const REQUIRED = [
	'SPOTIFY_CLIENT_ID',
	'SPOTIFY_CLIENT_SECRET',
	'SPOTIFY_REFRESH_TOKEN',
	'SPOTIFY_PLAYLIST_ID',
] as const;

export const GET: APIRoute = async () => {
	const present = Object.fromEntries(
		REQUIRED.map((name) => {
			const value = process.env[name];
			const meta = (import.meta.env as Record<string, unknown>)[name];
			const ok =
				(typeof value === 'string' && value.trim().length > 0) ||
				(typeof meta === 'string' && meta.trim().length > 0);
			return [name, ok];
		}),
	);

	const missing = REQUIRED.filter((name) => !present[name]);

	return new Response(
		JSON.stringify({
			ok: missing.length === 0,
			present,
			missing,
			hint:
				missing.length > 0
					? 'Add the missing variables in Vercel → Project Settings → Environment Variables (Production + Preview), then Redeploy.'
					: 'All Spotify env vars are visible to the server.',
		}),
		{
			status: missing.length === 0 ? 200 : 503,
			headers: { 'Content-Type': 'application/json' },
		},
	);
};
