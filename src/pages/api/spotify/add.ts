import type { APIRoute } from 'astro';
import {
	addTrackToPlaylist,
	getSpotifyPlaylistId,
	playlistContainsTrack,
} from '../../../utils/spotify';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	let body: { trackUri?: unknown };

	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const trackUri = typeof body.trackUri === 'string' ? body.trackUri.trim() : '';

	if (!trackUri || !trackUri.startsWith('spotify:track:')) {
		return new Response(JSON.stringify({ error: 'Invalid trackUri' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const playlistId = getSpotifyPlaylistId();
		const alreadyOnPlaylist = await playlistContainsTrack(playlistId, trackUri);

		if (alreadyOnPlaylist === true) {
			return new Response(
				JSON.stringify({
					ok: true,
					status: 'already_on_playlist',
					message: 'Track is already on the playlist',
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		await addTrackToPlaylist(playlistId, trackUri);

		return new Response(
			JSON.stringify({
				ok: true,
				status: 'added',
				message: 'Track added to playlist',
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to add track';
		console.error('[api/spotify/add]', message);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
