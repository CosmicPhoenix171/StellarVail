// Admin dashboard render layer — HTML composition, DOM updates, version-tab
// switching, the auth state gate, and the loadAdminDashboard entry point.

import { ADMIN_USERNAMES } from '../config/constants.js';
import {
	loadSongsForAdmin,
	loadVersionAnalytics,
	selectedAdminVersions,
	defaultVersionIndex,
} from './data.js';
import {
	formatNumber,
	formatPercent,
	formatTime,
	formatDurationSummary,
	formatDateTime,
	topEntries,
	topListeners,
	escapeHtml,
} from './formatters.js';

export function isAdminSignedIn() {
	return ADMIN_USERNAMES.includes(localStorage.getItem('sv_username'));
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
		renderMetric('Comments', formatNumber(totalComments)),
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

export async function loadAdminDashboard() {
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

export function showAdminState() {
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

export function goToNormalMode() {
	window.location.href = 'index.html';
}
