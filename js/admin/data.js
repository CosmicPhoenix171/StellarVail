// Admin data loading: song metadata, audio durations, per-version analytics.
//
// IMPORTANT: keep version-ID derivation in sync with the main app
// (js/features/songs.js → loadSongs and js/features/versions.js → versionId).
// The admin page uses its own selectedAdminVersions state, so it cannot
// reuse the main app's stateful versionId. The logic here is intentionally
// stateless and self-contained.

import { basePath, legacyIdMap } from '../config/constants.js';
import { ADMIN_SONG_CACHE_KEY, aliasIdMap } from './constants.js';
import { averageRating, formatSessionUser } from './formatters.js';

// Tracks the currently displayed version per song on the admin dashboard.
export const selectedAdminVersions = {};

export function defaultVersionIndex(song) {
	if (!song?.versions?.length) return 0;
	return song.versions.length - 1;
}

export function versionId(song, versionIndex) {
	const resolvedVersionIndex = versionIndex ?? defaultVersionIndex(song);
	if (!song.versions || song.versions.length <= 1 || resolvedVersionIndex === 0) return song.id;
	const label = song.versions[resolvedVersionIndex].label.toLowerCase().replace(/[^a-z0-9]/g, '');
	return `${song.id}-${label}`;
}

export function versionLabel(song, versionIndex) {
	if (!song.versions || !song.versions[versionIndex]) return 'Main';
	return song.versions[versionIndex].label || `V${versionIndex + 1}`;
}

// Returns every Firebase ID a song+version could have lived under in the past.
// The canonical ID (versionId) is always first; the rest are historical paths
// that may still hold ratings, comments, listens, or analytics.
export function getSongVersionSourceIds(song, versionIndex) {
	const ids = [];
	const canonical = versionId(song, versionIndex);
	ids.push(canonical);

	const filename = song.filename || '';
	const cleanBase = filename.replace(/\.[^.]+$/i, '');
	const wavBase = filename.replace(/\.wav$/i, '');

	const cleanSafe = cleanBase.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'"]/g, '');
	const wavSafe = wavBase.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'"]/g, '');

	const vi = versionIndex ?? defaultVersionIndex(song);
	const labelSuffix = (song.versions && song.versions.length > 1 && vi !== 0)
		? `-${song.versions[vi].label.toLowerCase().replace(/[^a-z0-9]/g, '')}`
		: '';

	[cleanSafe, wavSafe, legacyIdMap[filename]].forEach((base) => {
		if (!base) return;
		const candidate = `${base}${labelSuffix}`;
		if (candidate && !ids.includes(candidate)) ids.push(candidate);
	});

	// Explicit historical IDs from aliasIdMap (file renames, legacy songN keys)
	const aliasSources = aliasIdMap[canonical] || [];
	aliasSources.forEach((sourceId) => {
		if (sourceId && !ids.includes(sourceId)) ids.push(sourceId);
	});

	return ids;
}

// ── localStorage cache for audio-duration metadata ──

function readAdminSongCache() {
	try {
		const raw = localStorage.getItem(ADMIN_SONG_CACHE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writeAdminSongCache(cache) {
	try {
		localStorage.setItem(ADMIN_SONG_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// Ignore cache write failures; analytics still works without persistence.
	}
}

function buildSongCacheFingerprint(info) {
	return JSON.stringify({
		filename: info.filename || '',
		versions: info.versions || null,
	});
}

function loadAudioDuration(src) {
	return new Promise((resolve) => {
		const audio = new Audio();
		audio.preload = 'metadata';
		audio.addEventListener('loadedmetadata', () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0), { once: true });
		audio.addEventListener('error', () => resolve(0), { once: true });
		audio.src = src;
	});
}

export async function loadSongsForAdmin() {
	const indexResponse = await fetch(`${basePath}music/index.json`);
	const folders = await indexResponse.json();
	const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	const durationCache = readAdminSongCache();
	let cacheDirty = false;

	const loadedSongs = await Promise.all(folders.map(async (folder) => {
		try {
			const infoResponse = await fetch(`${basePath}music/${folder}/info.json`);
			const info = await infoResponse.json();
			const filename = info.filename;
			// Must match script.js / js/features/songs.js exactly — only strips
			// .wav, so .mp3/.ogg/.m4a files keep their extension fused into the
			// ID (e.g. "sugar-sweet-v3mp3"). Stripping all audio extensions here
			// would point admin at non-existent Firebase paths and show zero
			// analytics for every mp3-backed song.
			const baseName = filename.replace(/\.wav$/i, '');
			const safeId = baseName.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'"]/g, '');
			const versions = info.versions || null;
			const versionEntries = versions?.length ? versions : [{ filename: info.filename, label: 'Original' }];
			const cacheKey = folder;
			const fingerprint = buildSongCacheFingerprint(info);
			const cachedEntry = durationCache[cacheKey];
			const canUseCachedDurations = cachedEntry
				&& cachedEntry.fingerprint === fingerprint
				&& Array.isArray(cachedEntry.versionDurations)
				&& cachedEntry.versionDurations.length === versionEntries.length;
			const versionDurations = canUseCachedDurations
				? cachedEntry.versionDurations.map((value) => Number(value || 0))
				: await Promise.all(versionEntries.map((version) => loadAudioDuration(`${basePath}music/${folder}/${version.filename}`)));
			if (!canUseCachedDurations) {
				durationCache[cacheKey] = {
					fingerprint,
					versionDurations,
				};
				cacheDirty = true;
			}
			return {
				id: info.id || legacyIdMap[filename] || safeId,
				title: info.title || baseName,
				filename,
				folder,
				dateAdded: info.dateAdded || today,
				versions,
				baseDurationSeconds: versionDurations[0] || 0,
				versionDurationSeconds: versionDurations,
			};
		} catch (error) {
			console.warn(`Could not load admin info for ${folder}:`, error);
			return null;
		}
	}));

	if (cacheDirty) writeAdminSongCache(durationCache);

	return loadedSongs.filter(Boolean);
}

export async function loadVersionAnalytics(song, versionIndex) {
	const songVersionId = versionId(song, versionIndex);
	const snapshot = await database.ref(`songs/${songVersionId}`).once('value');
	const firebaseSong = snapshot.val() || {};
	const analytics = firebaseSong.analytics || {};
	const sessions = analytics.sessions || {};
	const byUser = analytics.byUser || {};
	const versionAggregate = analytics.versionPreference?.[`v${versionIndex}`] || {};
	const ratingStats = averageRating(firebaseSong.ratings);
	const sessionValues = Object.values(sessions);
	const sessionCount = sessionValues.length || Number(versionAggregate.sessions || 0);
	const creditedFromSessions = sessionValues.filter((session) => session.listenCredited).length;
	const completedFromSessions = sessionValues.filter((session) => session.completed).length;
	const maxProgressValues = sessionValues.map((session) => Number(session.maxProgressPercent || 0));
	const averageProgress = maxProgressValues.length
		? maxProgressValues.reduce((sum, progress) => sum + progress, 0) / maxProgressValues.length
		: 0;
	const pauseCount = sessionValues.reduce((sum, session) => sum + Number(session.pauseCount || 0), 0);
	const seekCount = sessionValues.reduce((sum, session) => sum + Number(session.seekCount || 0), 0);
	const backwardSeekCount = sessionValues.reduce((sum, session) => sum + Number(session.backwardSeekCount || 0), 0);
	const forwardSkipCount = sessionValues.reduce((sum, session) => sum + Number(session.forwardSkipCount || 0), 0);
	const firstStops = sessionValues.map((session) => Number(session.firstStopPointSeconds)).filter((seconds) => Number.isFinite(seconds));
	const averageFirstStop = firstStops.length
		? firstStops.reduce((sum, seconds) => sum + seconds, 0) / firstStops.length
		: 0;
	const repeatListenCount = Object.values(byUser).reduce((sum, userStats) => sum + Number(userStats.repeatListenCount || 0), 0);
	const latestSession = sessionValues.reduce((latest, session) => {
		const latestTime = Number(latest?.endedAt || latest?.updatedAt || latest?.startedAt || 0);
		const sessionTime = Number(session?.endedAt || session?.updatedAt || session?.startedAt || 0);
		return sessionTime > latestTime ? session : latest;
	}, null);

	return {
		song,
		versionIndex,
		songVersionId,
		versionLabel: versionLabel(song, versionIndex),
		versionFilename: song.versions?.[versionIndex]?.filename || song.filename,
		durationSeconds: Number(song.versionDurationSeconds?.[versionIndex] || song.baseDurationSeconds || 0),
		ratingAverage: ratingStats.average,
		ratingCount: ratingStats.count,
		commentCount: Object.keys(firebaseSong.feedback || {}).length,
		publicListens: Number(firebaseSong.listens || 0),
		sessionCount,
		creditedListenCount: creditedFromSessions || Number(versionAggregate.creditedListens || 0),
		completedCount: completedFromSessions || Number(versionAggregate.completedSessions || 0),
		averageProgress,
		pauseCount,
		seekCount,
		backwardSeekCount,
		forwardSkipCount,
		averageFirstStop,
		repeatListenCount,
		byUser,
		dropOffBuckets: analytics.dropOffBuckets || {},
		replayHotspots: analytics.replayHotspots || {},
		conversionCounts: analytics.conversionCounts || {},
		userCount: Object.keys(byUser).length,
		lastSessionAt: Number(latestSession?.endedAt || latestSession?.updatedAt || latestSession?.startedAt || 0),
		lastSessionUser: formatSessionUser(latestSession),
	};
}
