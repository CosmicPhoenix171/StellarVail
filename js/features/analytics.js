// Playback analytics: session tracking, drop-off buckets, conversions, and
// per-user aggregates synced to Firebase.

import { state } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';
import { getDisplayName } from './user.js';
import { resolveSongAndVersion } from './audio.js';

export function roundAnalyticsValue(value, digits = 2) {
	const factor = 10 ** digits;
	return Math.round((value || 0) * factor) / factor;
}

export function dropOffBucketForPercent(percent) {
	if (percent < 25) return '0-25';
	if (percent < 50) return '25-50';
	if (percent < 75) return '50-75';
	return '75-100';
}

export function timeBucketForSeconds(seconds, bucketSize = 10) {
	const start = Math.max(0, Math.floor((seconds || 0) / bucketSize) * bucketSize);
	return `${start}-${start + bucketSize}`;
}

export function incrementAnalyticsCounter(path, amount = 1) {
	if (typeof database === 'undefined') return;
	database.ref(path).transaction((current) => (current || 0) + amount);
}

export function createPlaybackAnalyticsSession(songId) {
	const resolved = resolveSongAndVersion(songId);
	return {
		sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		songId,
		baseSongId: resolved?.song?.id || songId,
		versionIndex: resolved?.vi ?? 0,
		clientId: state.clientId,
		displayName: getDisplayName(),
		username: localStorage.getItem('sv_username') || null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		endedAt: null,
		lastPositionSeconds: 0,
		maxPositionSeconds: 0,
		durationSeconds: 0,
		pauseCount: 0,
		resumeCount: 0,
		seekCount: 0,
		backwardSeekCount: 0,
		forwardSkipCount: 0,
		replayHotspots: {},
		firstStopPointSeconds: null,
		stopReason: null,
		listenCredited: false,
		listenInvalidated: false,
		completed: false,
		wasPaused: false,
		aggregateSaved: false,
	};
}

export function ensurePlaybackAnalytics(songId) {
	if (!songId || typeof database === 'undefined' || state.isAdminMode) return null;
	if (!state.playbackAnalytics || state.playbackAnalytics.songId !== songId) {
		if (state.playbackAnalytics && state.playbackAnalytics.songId !== songId) {
			savePlaybackAnalytics('switch-track', true);
		}
		state.playbackAnalytics = createPlaybackAnalyticsSession(songId);
		return state.playbackAnalytics;
	}
	if (state.playbackAnalytics.wasPaused) {
		state.playbackAnalytics.resumeCount += 1;
		state.playbackAnalytics.wasPaused = false;
	}
	state.playbackAnalytics.displayName = getDisplayName();
	state.playbackAnalytics.username = localStorage.getItem('sv_username') || null;
	return state.playbackAnalytics;
}

export function updatePlaybackAnalyticsSnapshot() {
	if (!state.playbackAnalytics) return null;
	const currentTime = Number.isFinite(audioPlayer?.currentTime) ? audioPlayer.currentTime : 0;
	const duration = Number.isFinite(audioPlayer?.duration) ? audioPlayer.duration : 0;
	state.playbackAnalytics.updatedAt = Date.now();
	state.playbackAnalytics.lastPositionSeconds = roundAnalyticsValue(currentTime);
	state.playbackAnalytics.maxPositionSeconds = Math.max(
		state.playbackAnalytics.maxPositionSeconds,
		state.playbackAnalytics.lastPositionSeconds
	);
	state.playbackAnalytics.durationSeconds = roundAnalyticsValue(duration);
	state.playbackAnalytics.listenCredited = state.listenCredited;
	state.playbackAnalytics.listenInvalidated = state.listenInvalidated;
	state.playbackAnalytics.completed = duration > 0 && state.playbackAnalytics.maxPositionSeconds >= duration * 0.98;
	return state.playbackAnalytics;
}

export function savePlaybackAnalytics(reason = 'progress', finalize = false) {
	if (!state.playbackAnalytics || typeof database === 'undefined' || state.isAdminMode) return;
	const session = updatePlaybackAnalyticsSnapshot();
	if (!session) return;

	if (finalize) {
		session.endedAt = Date.now();
		session.stopReason = reason;
	} else if (!session.stopReason || reason === 'pause') {
		session.stopReason = reason;
	}

	const maxProgressPercent = session.durationSeconds > 0
		? roundAnalyticsValue((session.maxPositionSeconds / session.durationSeconds) * 100, 1)
		: 0;
	const dropOffBucket = dropOffBucketForPercent(maxProgressPercent);
	if (finalize && session.firstStopPointSeconds === null) {
		session.firstStopPointSeconds = session.lastPositionSeconds;
	}

	const payload = {
		sessionId: session.sessionId,
		clientId: session.clientId,
		displayName: session.displayName,
		username: session.username,
		baseSongId: session.baseSongId,
		versionIndex: session.versionIndex,
		startedAt: session.startedAt,
		updatedAt: session.updatedAt,
		endedAt: session.endedAt,
		stopReason: session.stopReason,
		lastPositionSeconds: session.lastPositionSeconds,
		maxPositionSeconds: session.maxPositionSeconds,
		durationSeconds: session.durationSeconds,
		maxProgressPercent,
		dropOffBucket,
		firstStopPointSeconds: session.firstStopPointSeconds,
		pauseCount: session.pauseCount,
		resumeCount: session.resumeCount,
		seekCount: session.seekCount,
		backwardSeekCount: session.backwardSeekCount,
		forwardSkipCount: session.forwardSkipCount,
		replayHotspots: session.replayHotspots,
		listenCredited: session.listenCredited,
		listenInvalidated: session.listenInvalidated,
		completed: session.completed,
		finalized: finalize,
	};

	database.ref(`songs/${session.songId}/analytics/sessions/${session.sessionId}`).set(payload);

	if (finalize && !session.aggregateSaved) {
		session.aggregateSaved = true;
		const analyticsBasePath = `songs/${session.songId}/analytics`;
		incrementAnalyticsCounter(`${analyticsBasePath}/dropOffBuckets/${dropOffBucket}`);

		Object.entries(session.replayHotspots).forEach(([bucket, count]) => {
			incrementAnalyticsCounter(`${analyticsBasePath}/replayHotspots/${bucket}`, count);
		});

		const versionKey = `v${session.versionIndex}`;
		incrementAnalyticsCounter(`${analyticsBasePath}/versionPreference/${versionKey}/sessions`);
		incrementAnalyticsCounter(`${analyticsBasePath}/versionPreference/${versionKey}/completedSessions`, payload.completed ? 1 : 0);
		incrementAnalyticsCounter(`${analyticsBasePath}/versionPreference/${versionKey}/creditedListens`, payload.listenCredited ? 1 : 0);
		incrementAnalyticsCounter(`${analyticsBasePath}/versionPreference/${versionKey}/replays`, payload.backwardSeekCount);
		database.ref(`${analyticsBasePath}/versionPreference/${versionKey}/lastListenedAt`).set(payload.endedAt || Date.now());

		database.ref(`songs/${session.songId}/analytics/byUser/${session.clientId}`).transaction((current) => {
			const next = current || {
				clientId: session.clientId,
				listenSessions: 0,
				repeatListenCount: 0,
				completedSessions: 0,
				totalPlaySeconds: 0,
				totalPauseCount: 0,
				totalSeekCount: 0,
				backwardSeekCount: 0,
				forwardSkipCount: 0,
				lastStopPositionSeconds: 0,
				firstStopPointSeconds: null,
				maxProgressPercent: 0,
				lastListenedAt: 0,
				versionPreference: {},
			};
			const hadPriorListen = !!next.lastListenedAt;
			next.clientId = session.clientId;
			next.displayName = session.displayName;
			next.username = session.username;
			next.baseSongId = session.baseSongId;
			next.listenSessions = (next.listenSessions || 0) + 1;
			next.repeatListenCount = (next.repeatListenCount || 0) + (hadPriorListen ? 1 : 0);
			next.completedSessions = (next.completedSessions || 0) + (payload.completed ? 1 : 0);
			next.totalPlaySeconds = roundAnalyticsValue((next.totalPlaySeconds || 0) + payload.maxPositionSeconds);
			next.totalPauseCount = (next.totalPauseCount || 0) + payload.pauseCount;
			next.totalSeekCount = (next.totalSeekCount || 0) + payload.seekCount;
			next.backwardSeekCount = (next.backwardSeekCount || 0) + payload.backwardSeekCount;
			next.forwardSkipCount = (next.forwardSkipCount || 0) + payload.forwardSkipCount;
			next.lastStopPositionSeconds = payload.lastPositionSeconds;
			next.firstStopPointSeconds = next.firstStopPointSeconds ?? payload.firstStopPointSeconds;
			next.maxProgressPercent = Math.max(next.maxProgressPercent || 0, payload.maxProgressPercent);
			next.lastListenedAt = payload.endedAt || Date.now();
			if (!next.versionPreference) next.versionPreference = {};
			const versionStats = next.versionPreference[versionKey] || {
				sessions: 0,
				completedSessions: 0,
				creditedListens: 0,
				replays: 0,
				maxProgressPercent: 0,
			};
			versionStats.sessions += 1;
			versionStats.completedSessions += payload.completed ? 1 : 0;
			versionStats.creditedListens += payload.listenCredited ? 1 : 0;
			versionStats.replays += payload.backwardSeekCount;
			versionStats.maxProgressPercent = Math.max(versionStats.maxProgressPercent || 0, payload.maxProgressPercent);
			next.versionPreference[versionKey] = versionStats;
			if (payload.listenCredited) {
				next.lastCreditedListen = {
					sessionId: payload.sessionId,
					listenedAt: payload.endedAt || Date.now(),
					maxProgressPercent: payload.maxProgressPercent,
					versionIndex: payload.versionIndex,
					completed: payload.completed,
				};
			}
			return next;
		});
	}

	if (finalize) {
		state.playbackAnalytics = null;
	}
}

function creditedListenFromActiveSession(songId) {
	const pa = state.playbackAnalytics;
	if (!pa || pa.songId !== songId || !pa.listenCredited) return null;
	return {
		sessionId: pa.sessionId,
		listenedAt: Date.now(),
		maxProgressPercent: pa.durationSeconds > 0
			? roundAnalyticsValue((pa.maxPositionSeconds / pa.durationSeconds) * 100, 1)
			: 0,
		versionIndex: pa.versionIndex,
		completed: pa.completed,
	};
}

function writeListenConversion(songId, type, creditedListen, details = {}) {
	const convertedAt = Date.now();
	const conversionId = `${state.clientId}_${convertedAt}`;
	const timeSinceListenMs = Math.max(0, convertedAt - creditedListen.listenedAt);
	const payload = {
		type,
		clientId: state.clientId,
		displayName: getDisplayName(),
		username: localStorage.getItem('sv_username') || null,
		listenSessionId: creditedListen.sessionId,
		listenedAt: creditedListen.listenedAt,
		convertedAt,
		timeSinceListenMs,
		listenMaxProgressPercent: creditedListen.maxProgressPercent || 0,
		listenVersionIndex: creditedListen.versionIndex ?? 0,
		listenCompleted: !!creditedListen.completed,
		...details,
	};

	database.ref(`songs/${songId}/analytics/conversions/${type}/${conversionId}`).set(payload);
	incrementAnalyticsCounter(`songs/${songId}/analytics/conversionCounts/${type}`);
	database.ref(`songs/${songId}/analytics/byUser/${state.clientId}/last${type === 'rating' ? 'Rating' : 'Comment'}Conversion`).set(payload);
}

export function recordListenConversion(songId, type, details = {}) {
	if (typeof database === 'undefined' || state.isAdminMode) return;
	const activeCreditedListen = creditedListenFromActiveSession(songId);
	if (activeCreditedListen) {
		writeListenConversion(songId, type, activeCreditedListen, details);
		return;
	}

	const conversionRoot = database.ref(`songs/${songId}/analytics/byUser/${state.clientId}/lastCreditedListen`);
	conversionRoot.once('value', (snapshot) => {
		const creditedListen = snapshot.val();
		if (!creditedListen?.sessionId || !creditedListen.listenedAt) return;
		writeListenConversion(songId, type, creditedListen, details);
	});
}
