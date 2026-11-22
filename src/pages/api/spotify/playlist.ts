import type { APIRoute } from 'astro';
import { getPlaylistTracks, getSpotifyPlaylistId } from '../../../utils/spotify';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		const playlistId = getSpotifyPlaylistId();
		const tracks = await getPlaylistTracks(playlistId, 40);
		return new Response(JSON.stringify({ tracks }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to load playlist';
		console.error('[api/spotify/playlist]', message);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
