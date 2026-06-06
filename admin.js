const ADMIN_USERNAMES = ['Phoenix'];
const basePath = '';
const selectedAdminVersions = {};
const ADMIN_SONG_CACHE_KEY = 'sv_admin_song_cache_v1';

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
	'where.wav': 'song19'
};

function isAdminSignedIn() {
	return ADMIN_USERNAMES.includes(localStorage.getItem('sv_username'));
}

function defaultVersionIndex(song) {
	if (!song?.versions?.length) return 0;
	return song.versions.length - 1;
}

function versionId(song, versionIndex) {
	const resolvedVersionIndex = versionIndex ?? defaultVersionIndex(song);
	if (!song.versions || song.versions.length <= 1 || resolvedVersionIndex === 0) return song.id;
	const label = song.versions[resolvedVersionIndex].label.toLowerCase().replace(/[^a-z0-9]/g, '');
	return `${song.id}-${label}`;
}

function versionLabel(song, versionIndex) {
	if (!song.versions || !song.versions[versionIndex]) return 'Main';
	return song.versions[versionIndex].label || `V${versionIndex + 1}`;
}

function formatNumber(value, digits = 0) {
	const numberValue = Number(value || 0);
	return numberValue.toLocaleString(undefined, {
		maximumFractionDigits: digits,
		minimumFractionDigits: digits > 0 && numberValue % 1 !== 0 ? digits : 0
	});
}

function formatPercent(value) {
	return `${formatNumber(value || 0, 1)}%`;
}

function formatTime(seconds) {
	const totalSeconds = Math.max(0, Math.round(seconds || 0));
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;
	return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatDurationSummary(seconds) {
	const totalSeconds = Math.max(0, Math.round(seconds || 0));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainingSeconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
	return `${remainingSeconds}s`;
}

function formatDateTime(timestamp) {
	if (!timestamp) return '-';
	return new Date(timestamp).toLocaleString();
}

function formatSessionUser(session) {
	if (!session) return 'Unknown listener';
	return session.displayName || session.username || session.clientId || 'Unknown listener';
}

function averageRating(ratings) {
	const ratingValues = Object.values(ratings || {})
		.map((entry) => {
			if (entry && typeof entry === 'object') return Number(entry.rating);
			return Number(entry);
		})
		.filter((rating) => Number.isFinite(rating) && rating > 0);
	if (!ratingValues.length) return { count: 0, average: 0 };
	const total = ratingValues.reduce((sum, rating) => sum + rating, 0);
	return { count: ratingValues.length, average: total / ratingValues.length };
}

function topEntries(values, limit = 3) {
	return Object.entries(values || {})
		.sort((first, second) => Number(second[1] || 0) - Number(first[1] || 0))
		.slice(0, limit);
}

function topListeners(byUser, limit = 3) {
	return Object.values(byUser || {})
		.map((userStats) => ({
			label: userStats.displayName || userStats.username || userStats.clientId || 'Unknown listener',
			sessions: Number(userStats.listenSessions || 0)
		}))
		.filter((entry) => entry.sessions > 0)
		.sort((first, second) => second.sessions - first.sessions || first.label.localeCompare(second.label))
		.slice(0, limit);
}

function renderMetric(label, value) {
	return `<div class="admin-metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderMiniList(entries, emptyText) {
	if (!entries.length) return `<span class="admin-empty">${emptyText}</span>`;
	return entries.map(([label, value]) => `<span>${label}: <strong>${formatNumber(value)}</strong></span>`).join('');
}

function renderTopListeners(entries, emptyText) {
	if (!entries.length) return `<span class="admin-empty">${emptyText}</span>`;
	return entries.map((entry) => `<span>${escapeHtml(entry.label)}: <strong>${formatNumber(entry.sessions)}</strong> session${entry.sessions === 1 ? '' : 's'}</span>`).join('');
}

function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

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
		versions: info.versions || null
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

async function loadSongsForAdmin() {
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
			const baseName = filename.replace(/\.[^.]+$/i, '');
			const safeId = baseName.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'\"]/g, '');
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
					versionDurations
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
				versionDurationSeconds: versionDurations
			};
		} catch (error) {
			console.warn(`Could not load admin info for ${folder}:`, error);
			return null;
		}
	}));

	if (cacheDirty) writeAdminSongCache(durationCache);

	return loadedSongs.filter(Boolean);
}

async function loadVersionAnalytics(song, versionIndex) {
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
		lastSessionUser: formatSessionUser(latestSession)
	};
}

function selectAdminVersion(songId, versionIndex) {
	selectedAdminVersions[songId] = versionIndex;
	document.querySelectorAll(`.admin-version-tab[data-song-id="${songId}"]`).forEach((tab) => {
		tab.classList.toggle('active', Number(tab.dataset.versionIndex) === versionIndex);
	});
	document.querySelectorAll(`.admin-version-panel[data-song-id="${songId}"]`).forEach((panel) => {
		panel.hidden = Number(panel.dataset.versionIndex) !== versionIndex;
	});
}

function renderSummary(rows) {
	const summaryElement = document.getElementById('admin-summary');
	const songMap = new Map();
	rows.forEach((row) => {
		if (!songMap.has(row.song.id)) songMap.set(row.song.id, row.song);
	});
	const totalSongs = songMap.size;
	const totalVersions = rows.length;
	const totalSongDuration = Array.from(songMap.values()).reduce((sum, song) => sum + Number(song.baseDurationSeconds || 0), 0);
	const totalVersionDuration = rows.reduce((sum, row) => sum + Number(row.durationSeconds || 0), 0);
	const totalSessions = rows.reduce((sum, row) => sum + row.sessionCount, 0);
	const totalCredited = rows.reduce((sum, row) => sum + row.creditedListenCount, 0);
	const totalCompleted = rows.reduce((sum, row) => sum + row.completedCount, 0);
	const totalReplays = rows.reduce((sum, row) => sum + row.backwardSeekCount, 0);
	const totalRatings = rows.reduce((sum, row) => sum + row.ratingCount, 0);
	const totalComments = rows.reduce((sum, row) => sum + row.commentCount, 0);

	summaryElement.innerHTML = [
		renderMetric('Songs', formatNumber(totalSongs)),
		renderMetric('Versions', formatNumber(totalVersions)),
		renderMetric('All songs time', formatDurationSummary(totalSongDuration)),
		renderMetric('Songs + versions time', formatDurationSummary(totalVersionDuration)),
		renderMetric('Sessions', formatNumber(totalSessions)),
		renderMetric('Credited listens', formatNumber(totalCredited)),
		renderMetric('Finished listens', formatNumber(totalCompleted)),
		renderMetric('Replay jumps', formatNumber(totalReplays)),
		renderMetric('Ratings', formatNumber(totalRatings)),
		renderMetric('Comments', formatNumber(totalComments))
	].join('');
}

function renderVersionPanel(row, activeVersionIndex, songTotalPublicListens) {
	const dropOffEntries = topEntries(row.dropOffBuckets, 4);
	const replayEntries = topEntries(row.replayHotspots, 3);
	const conversionEntries = topEntries(row.conversionCounts, 3);
	const topListenerEntries = topListeners(row.byUser, 3);
	const ratingText = row.ratingCount ? `${formatNumber(row.ratingAverage, 1)} (${row.ratingCount})` : '-.-';
	const listenShare = songTotalPublicListens > 0 ? (row.publicListens / songTotalPublicListens) * 100 : 0;
 	const isActive = row.versionIndex === activeVersionIndex;

	return `
		<div class="admin-version-panel" data-song-id="${escapeHtml(row.song.id)}" data-version-index="${row.versionIndex}"${isActive ? '' : ' hidden'}>
			<div class="admin-version-meta">
				<div>
					<strong>${escapeHtml(row.versionLabel)}</strong>
					<span>${escapeHtml(row.versionFilename)}</span>
				</div>
				<div>
					<strong>Firebase path</strong>
					<span>songs/${escapeHtml(row.songVersionId)}</span>
				</div>
				<div>
					<strong>Last session</strong>
					<span>${formatDateTime(row.lastSessionAt)}${row.lastSessionAt ? ` · ${escapeHtml(row.lastSessionUser)}` : ''}</span>
				</div>
			</div>
			<div class="admin-card-metrics">
				${renderMetric('Rating', ratingText)}
				${renderMetric('Version listens', formatNumber(row.publicListens))}
				${renderMetric('Share of song listens', formatPercent(listenShare))}
				${renderMetric('Sessions', formatNumber(row.sessionCount))}
				${renderMetric('Credited', formatNumber(row.creditedListenCount))}
				${renderMetric('Completed', formatNumber(row.completedCount))}
				${renderMetric('Avg progress', formatPercent(row.averageProgress))}
				${renderMetric('First stop avg', row.averageFirstStop ? formatTime(row.averageFirstStop) : '-')}
				${renderMetric('Users', formatNumber(row.userCount))}
				${renderMetric('Repeats', formatNumber(row.repeatListenCount))}
				${renderMetric('Pauses', formatNumber(row.pauseCount))}
				${renderMetric('Seeks', formatNumber(row.seekCount))}
				${renderMetric('Forward skips', formatNumber(row.forwardSkipCount))}
			</div>
			<div class="admin-detail-grid">
				<div><h4>Drop-off buckets</h4>${renderMiniList(dropOffEntries, 'No drop-offs yet')}</div>
				<div><h4>Replay hotspots</h4>${renderMiniList(replayEntries, 'No replay jumps yet')}</div>
				<div><h4>Conversions</h4>${renderMiniList(conversionEntries, 'No conversions yet')}</div>
				<div><h4>Top listeners</h4>${renderTopListeners(topListenerEntries, 'No listener history yet')}</div>
			</div>
		</div>
	`;
}

function renderSongGroup(song, rows) {
	const sortedRows = [...rows].sort((first, second) => first.versionIndex - second.versionIndex);
	const totalSessions = sortedRows.reduce((sum, row) => sum + row.sessionCount, 0);
	const totalPublicListens = sortedRows.reduce((sum, row) => sum + row.publicListens, 0);
	const totalRatings = sortedRows.reduce((sum, row) => sum + row.ratingCount, 0);
	const latestSessionRow = [...sortedRows].sort((first, second) => second.lastSessionAt - first.lastSessionAt || second.publicListens - first.publicListens || second.sessionCount - first.sessionCount || first.versionIndex - second.versionIndex)[0] || sortedRows[0];
	const activeVersionIndex = selectedAdminVersions[song.id] ?? latestSessionRow?.versionIndex ?? defaultVersionIndex(song);
	const activeRow = sortedRows.find((row) => row.versionIndex === activeVersionIndex) || sortedRows[0];
	selectedAdminVersions[song.id] = activeRow.versionIndex;
	const versionTabs = sortedRows.map((row) => `
		<button class="admin-version-tab${row.versionIndex === activeRow.versionIndex ? ' active' : ''}" type="button" data-song-id="${escapeHtml(song.id)}" data-version-index="${row.versionIndex}">
			${escapeHtml(row.versionLabel)} · ${formatNumber(row.publicListens)}
		</button>
	`).join('');

	return `
		<article class="admin-song-card" data-song-id="${escapeHtml(song.id)}">
			<div class="admin-song-card-head">
				<div>
					<h3>${escapeHtml(song.title)}</h3>
					<p>${sortedRows.length} version${sortedRows.length === 1 ? '' : 's'} - ${formatNumber(totalPublicListens)} total listens - ${formatNumber(totalSessions)} sessions - ${formatNumber(totalRatings)} ratings</p>
				</div>
				<span>${formatDateTime(Math.max(...sortedRows.map((row) => row.lastSessionAt)))}</span>
			</div>
			<div class="admin-version-tabs" role="tablist" aria-label="${escapeHtml(song.title)} versions">
				${versionTabs}
			</div>
			${sortedRows.map((row) => renderVersionPanel(row, activeRow.versionIndex, totalPublicListens)).join('')}
		</article>
	`;
}

function groupRowsBySong(rows) {
	return rows.reduce((groups, row) => {
		if (!groups.has(row.song.id)) groups.set(row.song.id, { song: row.song, rows: [] });
		groups.get(row.song.id).rows.push(row);
		return groups;
	}, new Map());
}

function renderRows(rows) {
	const songListElement = document.getElementById('admin-song-list');
	const updatedAtElement = document.getElementById('admin-updated-at');
	const sortedRows = [...rows].sort((first, second) => second.lastSessionAt - first.lastSessionAt || second.publicListens - first.publicListens || second.sessionCount - first.sessionCount || first.song.title.localeCompare(second.song.title));
	const groupedRows = Array.from(groupRowsBySong(sortedRows).values()).sort((first, second) => {
		const latestFirst = Math.max(...first.rows.map((row) => row.lastSessionAt));
		const latestSecond = Math.max(...second.rows.map((row) => row.lastSessionAt));
		const totalListensFirst = first.rows.reduce((sum, row) => sum + row.publicListens, 0);
		const totalListensSecond = second.rows.reduce((sum, row) => sum + row.publicListens, 0);
		const totalSessionsFirst = first.rows.reduce((sum, row) => sum + row.sessionCount, 0);
		const totalSessionsSecond = second.rows.reduce((sum, row) => sum + row.sessionCount, 0);
		return latestSecond - latestFirst || totalListensSecond - totalListensFirst || totalSessionsSecond - totalSessionsFirst || first.song.title.localeCompare(second.song.title);
	});
	renderSummary(sortedRows);
	songListElement.innerHTML = groupedRows.map(({ song, rows: songRows }) => renderSongGroup(song, songRows)).join('') || '<p class="admin-empty-state">No songs found.</p>';
	songListElement.querySelectorAll('.admin-version-tab').forEach((button) => {
		button.addEventListener('click', () => selectAdminVersion(button.dataset.songId, Number(button.dataset.versionIndex)));
	});
	updatedAtElement.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function loadAdminDashboard() {
	const songListElement = document.getElementById('admin-song-list');
	const updatedAtElement = document.getElementById('admin-updated-at');
	songListElement.innerHTML = '<p class="admin-empty-state">Loading analytics...</p>';
	updatedAtElement.textContent = 'Loading...';

	try {
		const songs = await loadSongsForAdmin();
		const analyticsPromises = [];
		songs.forEach((song) => {
			const versionCount = song.versions ? song.versions.length : 1;
			for (let versionIndex = 0; versionIndex < versionCount; versionIndex += 1) {
				analyticsPromises.push(loadVersionAnalytics(song, versionIndex));
			}
		});
		const rows = await Promise.all(analyticsPromises);
		renderRows(rows);
	} catch (error) {
		console.error('Unable to load admin analytics:', error);
		songListElement.innerHTML = '<p class="admin-empty-state">Could not load analytics. Check the console for details.</p>';
		updatedAtElement.textContent = 'Load failed';
	}
}

function showAdminState() {
	const lockedElement = document.getElementById('admin-locked');
	const dashboardElement = document.getElementById('admin-dashboard');
	if (!isAdminSignedIn()) {
		lockedElement.hidden = false;
		dashboardElement.hidden = true;
		return;
	}

	lockedElement.hidden = true;
	dashboardElement.hidden = false;
	loadAdminDashboard();
}

function goToNormalMode() {
	window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('normal-mode-btn')?.addEventListener('click', goToNormalMode);
	document.getElementById('locked-normal-btn')?.addEventListener('click', goToNormalMode);
	document.getElementById('admin-refresh-btn')?.addEventListener('click', loadAdminDashboard);
	showAdminState();
});
