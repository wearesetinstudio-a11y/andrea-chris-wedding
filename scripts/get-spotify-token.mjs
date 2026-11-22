import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const envPath = resolve(root, ".env");

function loadEnv(filePath) {
	const env = {};
	const text = readFileSync(filePath, "utf8");
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

function upsertEnvValue(filePath, key, value) {
	const text = readFileSync(filePath, "utf8");
	const lines = text.split(/\r?\n/);
	const prefix = `${key}=`;
	let found = false;
	const next = lines.map((line) => {
		if (line.trimStart().startsWith(prefix)) {
			found = true;
			return `${key}=${value}`;
		}
		return line;
	});
	if (!found) {
		if (next.length && next[next.length - 1] !== "") next.push("");
		next.push(`${key}=${value}`);
	}
	writeFileSync(filePath, next.join("\n"), "utf8");
}

const env = loadEnv(envPath);
const clientId = env.SPOTIFY_CLIENT_ID;
const clientSecret = env.SPOTIFY_CLIENT_SECRET;
const redirectUri = env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:4321/callback";

if (!clientId || !clientSecret) {
	console.error(
		"Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env",
	);
	process.exit(1);
}

if (clientSecret === "WKLEJ_TUTAJ_CLIENT_SECRET") {
	console.error(
		"\nSPOTIFY_CLIENT_SECRET is still the placeholder.\n" +
			"Open https://developer.spotify.com/dashboard → your app → Settings,\n" +
			"copy the Client Secret into .env, then run this script again.\n",
	);
	process.exit(1);
}

const scopes =
	"playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative";
const authUrl = new URL("https://accounts.spotify.com/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("scope", scopes);
authUrl.searchParams.set("show_dialog", "true");

console.log("\nOpen this URL in your browser to authorize:\n");
console.log(authUrl.toString());
console.log("\nWaiting for Spotify redirect on", redirectUri, "...\n");

const callbackHost = new URL(redirectUri).hostname || "127.0.0.1";
const callbackPort = Number(new URL(redirectUri).port || 80);

const server = createServer(async (req, res) => {
	const url = new URL(req.url, redirectUri);

	if (url.pathname !== "/callback") {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
		return;
	}

	const error = url.searchParams.get("error");
	if (error) {
		res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
		res.end(`<p>Authorization failed: ${error}</p>`);
		console.error("Authorization error:", error);
		server.close();
		return;
	}

	const code = url.searchParams.get("code");
	if (!code) {
		res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
		res.end("<p>Missing authorization code.</p>");
		return;
	}

	try {
		const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
			"base64",
		);
		const body = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		});

		const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
			method: "POST",
			headers: {
				Authorization: `Basic ${basic}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});

		const data = await tokenRes.json();

		if (!tokenRes.ok) {
			console.error("[spotify] token exchange failed:", data);
			throw new Error(
				data.error_description || data.error || tokenRes.statusText,
			);
		}

		if (!data.refresh_token) {
			throw new Error(
				"No refresh_token in response. Try revoking app access and run again.",
			);
		}

		upsertEnvValue(envPath, "SPOTIFY_REFRESH_TOKEN", data.refresh_token);

		console.log("\nSaved SPOTIFY_REFRESH_TOKEN to .env");
		console.log("Restart the Astro dev server, then try searching again.\n");

		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(
			'<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem"><h1>Success!</h1><p>You can close this tab.</p></body></html>',
		);
	} catch (err) {
		console.error("Token exchange failed:", err.message);
		res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
		res.end(`<p>Token exchange failed: ${err.message}</p>`);
	} finally {
		server.close();
	}
});

server.listen(callbackPort, callbackHost, () => {
	console.log(`Listening on ${redirectUri}`);
});

server.on("error", (err) => {
	console.error(
		`\nCould not listen on ${redirectUri}: ${err.message}\n` +
			"Stop whatever is using that port (or change SPOTIFY_REDIRECT_URI + Spotify dashboard redirect URI), then retry.\n",
	);
	process.exit(1);
});
