/**
 * build.js — StellarVail
 * Run with: node build.js
 *
 * Regenerates music/index.json and static per-track share pages under share/.
 * The share pages expose song-specific Open Graph metadata for Discord and
 * redirect browsers back to the main app with the matching track query.
 */

const fs = require('fs');
const path = require('path');

const publicSiteUrl = 'https://cosmicphoenix171.github.io/StellarVail';
const musicDir = path.join(__dirname, 'music');
const shareDir = path.join(__dirname, 'share');
const indexFile = path.join(musicDir, 'index.json');

const legacyIdMap = {
	'Tik.wav': 'song1',
	'before morning rise.wav': 'song2',
	'Broken.wav': 'song3',
	'UNREAD.wav': 'song4',
	'burn-it.wav': 'song5',
	'Chemical  Beat.wav': 'song6',
	'Demons.wav': 'song8',
	'Dream escape.wav': 'song9',
	'Emotion.wav': 'song10',
	'fantasy or reality.wav': 'song11',
	'Feel.wav': 'song12',
	'Hide Away.wav': 'song13',
	'Laser Fury.wav': 'song14',
	'midnight Ride.wav': 'song15',
	'Neon Riff.wav': 'song16',
	'Not enough.wav': 'song17',
	'Villain.wav': 'song18',
	'where.wav': 'song19'
};

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function readJsonFile(filePath) {
	const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
	return JSON.parse(raw);
}

function readExistingIndex() {
	if (!fs.existsSync(indexFile)) return [];
	return readJsonFile(indexFile);
}

function discoverSongFolders() {
	return fs.readdirSync(musicDir).filter((name) => {
		const fullPath = path.join(musicDir, name);
		return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, 'info.json'));
	});
}

function mergeFolderOrder(existing, discovered) {
	const existingSet = new Set(existing);
	const newFolders = discovered
		.filter((folder) => !existingSet.has(folder))
		.sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base' }));
	return [...existing.filter((folder) => discovered.includes(folder)), ...newFolders];
}

function buildSongId(info) {
	const filename = info.filename;
	const baseName = filename.replace(/\.wav$/i, '');
	const safeId = baseName.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'\"]/g, '');
	return info.id || legacyIdMap[filename] || safeId;
}

function versionId(song, versionIndex) {
	if (!song.versions || song.versions.length <= 1 || versionIndex === 0) return song.id;
	const label = song.versions[versionIndex].label.toLowerCase().replace(/[^a-z0-9]/g, '');
	return `${song.id}-${label}`;
}

function buildSongs(folderNames) {
	return folderNames.map((folder) => {
		const infoPath = path.join(musicDir, folder, 'info.json');
		const info = readJsonFile(infoPath);
		return {
			id: buildSongId(info),
			title: info.title || info.filename.replace(/\.[^.]+$/i, ''),
			filename: info.filename,
			folder,
			artist: info.artist || '',
			description: info.description || '',
			art: info.art || '',
			versions: info.versions || null
		};
	});
}

function buildTrackTitle(song, version, hasMultipleVersions) {
	if (!hasMultipleVersions) return song.title;
	return `${song.title} (${version.label || 'Original'})`;
}

function buildTrackDescription(song, trackTitle) {
	if (song.description) return song.description;
	if (song.artist) return `${trackTitle} by ${song.artist} on Stellar Vail.`;
	return `Listen to ${trackTitle} on Stellar Vail.`;
}

function resolveImageUrl(song) {
	if (song.art) {
		return `${publicSiteUrl}/music/${encodeURIComponent(song.folder)}/${encodeURIComponent(song.art)}`;
	}
	return `${publicSiteUrl}/Steller.png`;
}

function buildSharePageHtml({ trackTitle, description, imageUrl, shareUrl, redirectUrl }) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(trackTitle)} | Stellar Vail</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="music.song">
    <meta property="og:title" content="${escapeHtml(trackTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:site_name" content="Stellar Vail">
    <meta property="og:url" content="${escapeHtml(shareUrl)}">
    <meta property="og:image" content="${escapeHtml(imageUrl)}">
    <meta property="og:image:alt" content="${escapeHtml(trackTitle)} cover art">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(trackTitle)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
    <link rel="canonical" href="${escapeHtml(shareUrl)}">
    <meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}">
    <script>window.location.replace(${JSON.stringify(redirectUrl)});</script>
</head>
<body>
    <p>Redirecting to <a href="${escapeHtml(redirectUrl)}">${escapeHtml(trackTitle)}</a> on Stellar Vail.</p>
</body>
</html>
`;
}

function generateSharePages(songs) {
	fs.rmSync(shareDir, { recursive: true, force: true });
	fs.mkdirSync(shareDir, { recursive: true });

	let pageCount = 0;

	for (const song of songs) {
		const versions = song.versions?.length ? song.versions : [{ filename: song.filename, label: 'Original' }];
		const hasMultipleVersions = versions.length > 1;

		versions.forEach((version, versionIndex) => {
			const trackId = versionId(song, versionIndex);
			const trackTitle = buildTrackTitle(song, version, hasMultipleVersions);
			const description = buildTrackDescription(song, trackTitle);
			const imageUrl = resolveImageUrl(song);
			const encodedTrackId = encodeURIComponent(trackId);
			const shareUrl = `${publicSiteUrl}/share/${encodedTrackId}/`;
			const redirectUrl = `../../?track=${encodeURIComponent(trackId)}`;
			const targetDir = path.join(shareDir, trackId);

			fs.mkdirSync(targetDir, { recursive: true });
			fs.writeFileSync(
				path.join(targetDir, 'index.html'),
				buildSharePageHtml({ trackTitle, description, imageUrl, shareUrl, redirectUrl }),
				'utf8'
			);
			pageCount += 1;
		});
	}

	return pageCount;
}

const existing = readExistingIndex();
const discovered = discoverSongFolders();
const merged = mergeFolderOrder(existing, discovered);
const songs = buildSongs(merged);

fs.writeFileSync(indexFile, JSON.stringify(merged, null, 4), 'utf8');
const pageCount = generateSharePages(songs);

console.log(`music/index.json updated — ${merged.length} songs.`);
console.log(`share pages updated — ${pageCount} track previews.`);