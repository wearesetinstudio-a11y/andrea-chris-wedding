export type SpotifyTrack = {
	id: string;
	name: string;
	artist: string;
	albumCover: string | null;
	uri: string;
	previewUrl: string | null;
	alreadyOnPlaylist?: boolean;
};

export type SpotifyPlaylistTrack = {
	id: string;
	name: string;
	artist: string;
	uri: string;
	durationMs: number;
	previewUrl: string | null;
};

type TokenCache = {
	accessToken: string;
	expiresAt: number;
};

let userTokenCache: TokenCache | null = null;
let appTokenCache: TokenCache | null = null;

type PlaylistUriCache = {
	uris: Set<string>;
	expiresAt: number;
};

let playlistUriCache: PlaylistUriCache | null = null;
const PLAYLIST_URI_CACHE_MS = 60_000;

function peekEnv(
	name:
		| 'SPOTIFY_CLIENT_ID'
		| 'SPOTIFY_CLIENT_SECRET'
		| 'SPOTIFY_REFRESH_TOKEN'
		| 'SPOTIFY_PLAYLIST_ID',
): string | undefined {
	// Prefer process.env (Vercel runtime). Use dynamic import.meta.env[name]
	// only as a local-dev fallback — never static import.meta.env.SPOTIFY_*
	// access, which Vite inlines into the server bundle at build time.
	const fromProcess = process.env[name];
	if (typeof fromProcess === 'string' && fromProcess.trim()) {
		return fromProcess.trim();
	}

	const fromMeta = (import.meta.env as Record<string, unknown>)[name];
	if (typeof fromMeta === 'string' && fromMeta.trim()) {
		return fromMeta.trim();
	}

	return undefined;
}

function readEnv(
	name:
		| 'SPOTIFY_CLIENT_ID'
		| 'SPOTIFY_CLIENT_SECRET'
		| 'SPOTIFY_REFRESH_TOKEN'
		| 'SPOTIFY_PLAYLIST_ID',
): string {
	const value = peekEnv(name);
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	if (name === 'SPOTIFY_CLIENT_SECRET' && value === 'WKLEJ_TUTAJ_CLIENT_SECRET') {
		throw new Error(
			'SPOTIFY_CLIENT_SECRET is still the placeholder. Paste your real Spotify client secret into .env',
		);
	}

	return value;
}

function logSpotifyError(context: string, status: number, body: unknown) {
	console.error(`[spotify] ${context} failed (${status}):`, body);
}

async function requestAccessToken(
	body: URLSearchParams,
	context: string,
): Promise<TokenCache> {
	const clientId = readEnv('SPOTIFY_CLIENT_ID');
	const clientSecret = readEnv('SPOTIFY_CLIENT_SECRET');
	const basic = btoa(`${clientId}:${clientSecret}`);

	const response = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body,
	});

	const data = (await response.json()) as {
		access_token?: string;
		expires_in?: number;
		scope?: string;
		error?: string;
		error_description?: string;
	};

	if (!response.ok || !data.access_token) {
		logSpotifyError(context, response.status, data);
		throw new Error(
			data.error_description || data.error || `Failed Spotify auth: ${context}`,
		);
	}

	if (data.scope) {
		console.info(`[spotify] ${context} scopes:`, data.scope);
	}

	const expiresInMs = (data.expires_in ?? 3600) * 1000;
	return {
		accessToken: data.access_token,
		expiresAt: Date.now() + expiresInMs - 60_000,
	};
}

/** App-only token (enough for search). */
export async function getSpotifyAppAccessToken(): Promise<string> {
	const now = Date.now();
	if (appTokenCache && now < appTokenCache.expiresAt) {
		return appTokenCache.accessToken;
	}

	appTokenCache = await requestAccessToken(
		new URLSearchParams({ grant_type: 'client_credentials' }),
		'client credentials',
	);
	return appTokenCache.accessToken;
}

/**
 * User token from refresh_token (needed to modify playlists).
 * Falls back to app token only when a refresh token is missing and allowAppFallback is true.
 */
export async function getSpotifyAccessToken(): Promise<string> {
	const now = Date.now();
	if (userTokenCache && now < userTokenCache.expiresAt) {
		return userTokenCache.accessToken;
	}

	const refreshToken = peekEnv('SPOTIFY_REFRESH_TOKEN');
	if (!refreshToken) {
		throw new Error(
			'Missing SPOTIFY_REFRESH_TOKEN. Run: node scripts/get-spotify-token.mjs',
		);
	}

	userTokenCache = await requestAccessToken(
		new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		}),
		'token refresh',
	);
	return userTokenCache.accessToken;
}

export function getSpotifyPlaylistId(): string {
	return readEnv('SPOTIFY_PLAYLIST_ID');
}

export async function getPlaylistTrackUriSet(playlistId: string): Promise<Set<string>> {
	const now = Date.now();
	if (playlistUriCache && now < playlistUriCache.expiresAt) {
		return playlistUriCache.uris;
	}

	const accessToken = await getSpotifyAccessToken();
	const uris = await fetchPlaylistTrackUris(playlistId, accessToken);
	playlistUriCache = {
		uris,
		expiresAt: now + PLAYLIST_URI_CACHE_MS,
	};
	return uris;
}

export function rememberPlaylistTrackUri(trackUri: string) {
	if (!playlistUriCache) {
		playlistUriCache = {
			uris: new Set([trackUri]),
			expiresAt: Date.now() + PLAYLIST_URI_CACHE_MS,
		};
		return;
	}
	playlistUriCache.uris.add(trackUri);
}

export async function searchTracks(query: string, limit = 5): Promise<SpotifyTrack[]> {
	// Search works with client credentials (no user refresh token required)
	const accessToken = await getSpotifyAppAccessToken();
	const url = new URL('https://api.spotify.com/v1/search');
	url.searchParams.set('type', 'track');
	url.searchParams.set('limit', String(limit));
	url.searchParams.set('q', query);
	// Improves chance of receiving preview_url for the region
	url.searchParams.set('market', 'PA');

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	const data = (await response.json()) as {
		tracks?: {
			items?: Array<{
				id: string;
				name: string;
				uri: string;
				preview_url?: string | null;
				artists?: Array<{ name: string }>;
				album?: { images?: Array<{ url: string }> };
			}>;
		};
		error?: { message?: string; status?: number };
	};

	if (!response.ok) {
		logSpotifyError('search', response.status, data);
		throw new Error(data.error?.message || 'Spotify search failed');
	}

	const tracks = (data.tracks?.items ?? []).map((track) => ({
		id: track.id,
		name: track.name,
		artist: (track.artists ?? []).map((a) => a.name).join(', '),
		albumCover: track.album?.images?.[0]?.url ?? null,
		uri: track.uri,
		previewUrl: track.preview_url ?? null,
	}));

	try {
		const playlistId = getSpotifyPlaylistId();
		const playlistUris = await getPlaylistTrackUriSet(playlistId);
		return tracks.map((track) => ({
			...track,
			alreadyOnPlaylist: playlistUris.has(track.uri),
		}));
	} catch (error) {
		console.warn(
			'[spotify] could not mark playlist duplicates in search:',
			error instanceof Error ? error.message : error,
		);
		return tracks;
	}
}

type SpotifyApiTrack = {
	id?: string;
	name?: string;
	uri?: string;
	duration_ms?: number;
	preview_url?: string | null;
	artists?: Array<{ name: string }>;
};

type PlaylistPage = {
	items?: Array<{
		track?: SpotifyApiTrack | null;
		item?: SpotifyApiTrack | null;
	}>;
	next?: string | null;
	error?: { message?: string };
};

function formatPlaylistItem(track: SpotifyApiTrack | null | undefined): SpotifyPlaylistTrack | null {
	if (!track?.uri || !track.name) return null;
	return {
		id: track.id ?? track.uri,
		name: track.name,
		artist: (track.artists ?? []).map((a) => a.name).join(', '),
		uri: track.uri,
		durationMs: track.duration_ms ?? 0,
		previewUrl: track.preview_url ?? null,
	};
}

export async function getPlaylistTracks(
	playlistId: string,
	limit = 40,
): Promise<SpotifyPlaylistTrack[]> {
	const accessToken = await getSpotifyAccessToken();
	const tracks: SpotifyPlaylistTrack[] = [];
	const endpoints = [
		`https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50`,
		`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=50`,
	];

	let lastError: string | null = null;

	const pushItems = (
		items: Array<{ track?: SpotifyApiTrack | null; item?: SpotifyApiTrack | null }>,
	) => {
		for (const row of items) {
			const formatted = formatPlaylistItem(row.item ?? row.track);
			if (formatted) tracks.push(formatted);
			if (tracks.length >= limit) return true;
		}
		return false;
	};

	for (const startUrl of endpoints) {
		tracks.length = 0;
		const first = await fetch(startUrl, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		const firstData = (await first.json()) as PlaylistPage;

		if (!first.ok) {
			lastError = firstData.error?.message || `HTTP ${first.status}`;
			logSpotifyError('playlist tracks list', first.status, firstData);
			continue;
		}

		if (pushItems(firstData.items ?? [])) return tracks;

		let nextUrl = firstData.next ?? null;
		while (nextUrl) {
			const pageRes = await fetch(nextUrl, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			const page = (await pageRes.json()) as PlaylistPage;

			if (!pageRes.ok) {
				logSpotifyError('playlist tracks page', pageRes.status, page);
				throw new Error(page.error?.message || 'Failed to read playlist');
			}

			if (pushItems(page.items ?? [])) return tracks;
			nextUrl = page.next ?? null;
		}

		return tracks;
	}

	throw new Error(lastError || 'Failed to read playlist');
}

async function fetchPlaylistTrackUris(playlistId: string, accessToken: string): Promise<Set<string>> {
	const uris = new Set<string>();
	// Prefer /items (current API). Fall back to /tracks if needed.
	const endpoints = [
		`https://api.spotify.com/v1/playlists/${playlistId}/items?fields=items(track.uri,item.uri),next&limit=50`,
		`https://api.spotify.com/v1/playlists/${playlistId}/tracks?fields=items(track(uri)),next&limit=50`,
	];

	let nextUrl: string | null = null;
	let lastError: string | null = null;

	for (const startUrl of endpoints) {
		const response = await fetch(startUrl, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		const data = (await response.json()) as {
			items?: Array<{
				track?: { uri?: string } | null;
				item?: { uri?: string } | null;
				uri?: string;
			}>;
			next?: string | null;
			error?: { message?: string };
		};

		if (!response.ok) {
			lastError = data.error?.message || `HTTP ${response.status}`;
			logSpotifyError('playlist items', response.status, data);
			continue;
		}

		nextUrl = startUrl;
		for (const item of data.items ?? []) {
			const uri = item.track?.uri ?? item.item?.uri ?? item.uri;
			if (uri) uris.add(uri);
		}
		nextUrl = data.next ?? null;

		while (nextUrl) {
			const pageRes = await fetch(nextUrl, {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			const page = (await pageRes.json()) as {
				items?: Array<{
					track?: { uri?: string } | null;
					item?: { uri?: string } | null;
					uri?: string;
				}>;
				next?: string | null;
				error?: { message?: string };
			};

			if (!pageRes.ok) {
				logSpotifyError('playlist items page', pageRes.status, page);
				throw new Error(page.error?.message || 'Failed to read playlist items');
			}

			for (const item of page.items ?? []) {
				const uri = item.track?.uri ?? item.item?.uri ?? item.uri;
				if (uri) uris.add(uri);
			}
			nextUrl = page.next ?? null;
		}

		return uris;
	}

	throw new Error(lastError || 'Failed to read playlist items');
}

export async function playlistContainsTrack(
	playlistId: string,
	trackUri: string,
): Promise<boolean | null> {
	try {
		const uris = await getPlaylistTrackUriSet(playlistId);
		return uris.has(trackUri);
	} catch (error) {
		// Don't block adding if Spotify forbids reading items (known 403 on some playlists)
		console.warn(
			'[spotify] duplicate check skipped:',
			error instanceof Error ? error.message : error,
		);
		return null;
	}
}

export async function addTrackToPlaylist(
	playlistId: string,
	trackUri: string,
): Promise<void> {
	const accessToken = await getSpotifyAccessToken();

	// Spotify migrated playlist writes from /tracks → /items
	const endpoints = [
		`https://api.spotify.com/v1/playlists/${playlistId}/items`,
		`https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
	];

	let lastError = 'Failed to add track to playlist';

	for (const endpoint of endpoints) {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ uris: [trackUri] }),
		});

		if (response.ok) {
			rememberPlaylistTrackUri(trackUri);
			return;
		}

		const data = (await response.json().catch(() => ({}))) as {
			error?: { message?: string };
		};
		lastError = data.error?.message || lastError;
		logSpotifyError(`add track (${endpoint.split('/').pop()})`, response.status, data);

		// Only fall back when the new endpoint is missing/forbidden
		if (response.status !== 403 && response.status !== 404) {
			throw new Error(lastError);
		}
	}

	throw new Error(lastError);
}
