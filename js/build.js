/**
 * build.js — StellarVail
 * Run with: node js/build.js (from the project root)
 *
 * Regenerates music/index.json and static per-track share pages inside each music folder.
 * The share pages expose song-specific Open Graph metadata for Discord and
 * redirect browsers back to the main app with the matching track query.
 *
 * Node CommonJS tooling — intentionally not converted to ES module since
 * there is no package.json declaring "type": "module" and this file is
 * only invoked from the command line, not the browser bundle.
 */

const fs = require('fs');
const path = require('path');

const publicSiteUrl = 'https://cosmicphoenix171.github.io/StellarVail';
const projectRoot = path.join(__dirname, '..');
const musicDir = path.join(projectRoot, 'music');
const indexFile = path.join(musicDir, 'index.json');

// Kept in sync with js/config/constants.js → legacyIdMap. Duplicated here
// because this Node script can't trivially import from an ES module without
// a package.json declaring "type": "module".
const legacyIdMap = {
	'Tik.wav': 'song1',
	'before morning rise.wav': 'song2',
	'Broken.wav': 'song3',
	'UNREAD.wav': 'song4',
	'burn-it.wav': 'song5',
	'Chemical  Beat.wav': 'song6',
	'Demons.wav': 'song8',
	'Feel.wav': 'song12',
	'Hide Away.wav': 'song13',
	'Laser Fury.wav': 'song14',
	'midnight Ride.wav': 'song15',
	'Neon Riff.wav': 'song16',
	'Not enough.wav': 'song17',
	'Villain.wav': 'song18',
	'where.wav': 'song19',
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

function normalizeShareSlug(value, stripExtension = false) {
	let normalizedValue = String(value || '').toLowerCase().trim();
	if (stripExtension) {
		normalizedValue = normalizedValue.replace(/\.[a-z0-9]+$/i, '');
	}
	return normalizedValue
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function discoverSongFolders() {
	return fs.readdirSync(musicDir).filter((name) => {
		const fullPath = path.join(musicDir, name);
		if (!fs.statSync(fullPath).isDirectory()) return false;
		const infoPath = path.join(fullPath, 'info.json');
		if (!fs.existsSync(infoPath)) return false;
		const info = readJsonFile(infoPath);
		return info.disabled !== true;
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
	const baseName = filename.replace(/\.[^.]+$/i, '');
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
			shareSlug: info.shareSlug || '',
			filename: info.filename,
			folder,
			artist: info.artist || '',
			genres: info.genres || [],
			description: info.description || '',
			art: info.art || '',
			versions: info.versions || null,
		};
	});
}

function buildTrackTitle(song, version, hasMultipleVersions) {
	if (!hasMultipleVersions) return song.title;
	return `${song.title} (${version.label || 'Original'})`;
}

function buildShareCardTitle(song) {
	return song.title;
}

function buildSongSharePath(song) {
	return normalizeShareSlug(song.shareSlug || song.title || song.folder || song.id, true);
}

function buildVersionShareSlug(song, versionIndex) {
	if (!song.versions || song.versions.length <= 1 || versionIndex === 0) return '';
	return normalizeShareSlug(song.versions[versionIndex].label || `v${versionIndex + 1}`);
}

function buildTrackDescription(song, trackTitle) {
	return 'Listen now';
}

function resolveImageUrl(song) {
	if (song.art) {
		const encodedFolder = encodeURIComponent(song.folder);
		const encodedArtPath = song.art
			.replace(/\\/g, '/')
			.split('/')
			.map((segment) => encodeURIComponent(segment))
			.join('/');
		return new URL(`music/${encodedFolder}/${encodedArtPath}`, `${publicSiteUrl}/`).toString();
	}
	return `${publicSiteUrl}/Steller.png`;
}

function buildSharePageHtml({ cardTitle, trackTitle, description, imageUrl, shareUrl, redirectUrl, defaultTrackId, versionTargets }) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(cardTitle)} | Stellar Vail</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta property="og:type" content="music.song">
	<meta property="og:title" content="${escapeHtml(cardTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:site_name" content="Stellar Vail">
    <meta property="og:url" content="${escapeHtml(shareUrl)}">
    <meta property="og:image" content="${escapeHtml(imageUrl)}">
	<meta property="og:image:alt" content="${escapeHtml(cardTitle)} cover art">
    <meta name="twitter:card" content="summary_large_image">
	<meta name="twitter:title" content="${escapeHtml(cardTitle)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
    <link rel="canonical" href="${escapeHtml(shareUrl)}">
	<script>
	(function () {
		const defaultTrackId = ${JSON.stringify(defaultTrackId)};
		const versionTargets = ${JSON.stringify(versionTargets)};
		const params = new URLSearchParams(window.location.search);
		const versionSlug = (params.get('v') || '').trim().toLowerCase();
		const targetTrackId = versionTargets[versionSlug] || defaultTrackId;
		const fallbackLink = document.getElementById('share-redirect-link');
		const targetUrl = '../../?track=' + encodeURIComponent(targetTrackId);
		if (fallbackLink) fallbackLink.href = targetUrl;
		window.location.replace(targetUrl);
	}());
	</script>
</head>
<body>
	<p>Redirecting to <a id="share-redirect-link" href="${escapeHtml(redirectUrl)}">${escapeHtml(trackTitle)}</a> on Stellar Vail.</p>
	<noscript>
		<p>JavaScript is required to open the exact shared version. Without it, this link opens the default version.</p>
	</noscript>
</body>
</html>
`;
}

function generateSharePages(songs) {
	const legacyShareDir = path.join(projectRoot, 'share');
	fs.rmSync(legacyShareDir, { recursive: true, force: true });

	let pageCount = 0;

	for (const song of songs) {
		const versions = song.versions?.length ? song.versions : [{ filename: song.filename, label: 'Original' }];
		const hasMultipleVersions = versions.length > 1;
		const defaultTrackId = versionId(song, 0);
		const trackTitle = buildTrackTitle(song, versions[0], hasMultipleVersions);
		const cardTitle = buildShareCardTitle(song);
		const description = buildTrackDescription(song, trackTitle);
		const imageUrl = resolveImageUrl(song);
		const encodedFolder = encodeURIComponent(song.folder);
		const shareUrl = `${publicSiteUrl}/music/${encodedFolder}/`;
		const redirectUrl = `../../?track=${encodeURIComponent(defaultTrackId)}`;
		const targetDir = path.join(musicDir, song.folder);
		const versionTargets = {};

		versions.forEach((version, versionIndex) => {
			const versionSlug = buildVersionShareSlug(song, versionIndex);
			if (!versionSlug) return;
			versionTargets[versionSlug] = versionId(song, versionIndex);
		});

		fs.writeFileSync(
			path.join(targetDir, 'index.html'),
			buildSharePageHtml({ cardTitle, trackTitle, description, imageUrl, shareUrl, redirectUrl, defaultTrackId, versionTargets }),
			'utf8'
		);
		pageCount += 1;
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
