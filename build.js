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
const indexFile = path.join(musicDir, 'index.json');

const shareDescriptionsByFolder = {
	'Tik': 'A sharp, glitch-lit rush of rhythm and tension built to hit fast and stay in your head. Listen now.',
	'before morning rise': 'A quiet late-night drift that blooms into something warm, hopeful, and impossible to shake. Listen now.',
	'Broken': 'A bruised, emotional electronic anthem about fallout, silence, and what survives after the break. Listen now.',
	'UNREAD': 'An electro-pop, EDM, and glitch pop track charged with distance, suspense, and all the words still left unopened. Listen now.',
	'Chemical  Beat': 'A neon-fueled pulse of synthetic energy, restless motion, and pure club-night momentum. Listen now.',
	'Dream escape': 'A soaring escape into motion, memory, and the kind of night that feels bigger than real life. Listen now.',
	'Emotion': 'A luminous synth-driven confession that leans fully into feeling, vulnerability, and release. Listen now.',
	'fantasy or reality': 'A dreamy, cinematic track caught between obsession and truth, where the line keeps disappearing. Listen now.',
	'where': 'A searching, atmospheric song about distance, longing, and trying to find the signal through the dark. Listen now.',
	'Burn it P.M.E.L.V': 'An intense electronic burn of chaos, adrenaline, and starting over with the match already lit. Listen now.',
	'Clockwork': 'A tightly wound mechanical groove where precision, pressure, and momentum lock perfectly into place. Listen now.',
	'Dreamloop': 'A hypnotic loop of memory and melody that keeps pulling you deeper every time it turns. Listen now.',
	'Found you': 'A bright, emotional rush about finally reaching the person or feeling you thought you lost. Listen now.',
	'Hide Away V2': 'A sleek escape anthem with late-night tension, magnetic hooks, and nowhere safe left to hide. Listen now.',
	'I know': 'A direct, intimate track that hits with certainty, ache, and the weight of what can no longer be denied. Listen now.',
	"I'm doing fine": 'A bittersweet synth-pop confession that says one thing out loud and another underneath. Listen now.',
	'My Way': 'A defiant, self-owned anthem about choosing your path and living with the volume turned all the way up. Listen now.',
	'Romance.exe V2': 'A digital-age love song where longing, obsession, and synthetic beauty blur into one signal. Listen now.',
	'Take the chance': 'An urgent leap-forward track about risk, possibility, and saying yes before the moment disappears. Listen now.',
	'Toxic tears': 'A dark, shimmering release of heartbreak, damage, and beauty still glowing through the ruin. Listen now.',
	'404': 'A glitchy emotional blackout where connection fails, the signal drops, and the feeling keeps echoing. Listen now.',
	'Demon in Disguise': 'A dramatic, shadow-lit track about temptation, masks, and the danger hidden behind attraction. Listen now.',
	'Fairytale': 'A romantic, dream-bright song that feels like magic until the cracks start to show. Listen now.',
	'Halloween, Halloween': 'A playful haunted rush of candy-night chaos, costumes, and dark-pop energy. Listen now.',
	'Looping': 'A restless spiral of hooks and momentum that keeps circling back stronger each time. Listen now.',
	'More Than Code': 'A cinematic synth-pop track about love, identity, and feeling human inside the machine. Listen now.',
	'Sugar Sweet': 'A glossy, addictive rush of charm and bite that feels sugary on the surface and dangerous underneath. Listen now.',
	'1 Unread': 'An electro-pop, EDM, and glitch pop remix built from missed messages, unresolved tension, and everything waiting behind one notification. Listen now.'
};

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
			shareSlug: info.shareSlug || '',
			filename: info.filename,
			folder,
			artist: info.artist || '',
			genres: info.genres || [],
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
	const mappedDescription = shareDescriptionsByFolder[song.folder];
	if (mappedDescription) return mappedDescription;
	if (song.description) return song.description;
	if (song.genres?.length) return `${song.genres.join(', ')} on Stellar Vail. Listen now.`;
	if (song.artist) return `${trackTitle} by ${song.artist} on Stellar Vail.`;
	return `Listen to ${trackTitle} on Stellar Vail.`;
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
	const legacyShareDir = path.join(__dirname, 'share');
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