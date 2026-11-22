import type { APIRoute } from 'astro';
import { searchTracks } from '../../../utils/spotify';

export const prerender = false;

export const GET: APIRoute = async ({ url, request }) => {
	// Prefer Astro's parsed URL; fall back to request.url for edge cases in dev
	const requestUrl = new URL(request.url);
	const q =
		url.searchParams.get('q')?.trim() ||
		requestUrl.searchParams.get('q')?.trim() ||
		'';

	if (!q) {
		return new Response(JSON.stringify({ tracks: [] }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const tracks = await searchTracks(q, 5);
		return new Response(JSON.stringify({ tracks }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Search failed';
		console.error('[api/spotify/search]', message);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
