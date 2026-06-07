// Mutable application state shared across modules.
// Modules import `state` and read/write fields directly so all consumers
// observe the same live values.

export const state = {
	// Current playback
	currentSongId: null,
	currentSongRated: false,
	listenCreditSongId: null,
	listenCredited: false,
	listenInvalidated: false, // True if user skipped forward
	lastPlaybackTime: 0,

	// Library data
	songsData: [],
	songStats: {},

	// Selection / DOM bookkeeping
	activeCardElement: null,
	selectedCardElement: null,
	selectedSongId: null,

	// Modes
	shuffleMode: false,
	autoplayQueueEnabled: localStorage.getItem('sv_autoplay_queue') !== '0',
	loopSongEnabled: localStorage.getItem('sv_loop_song') === '1',
	auroraDisabled: localStorage.getItem('sv_disable_aurora') === '1',
	uiHidden: false,
	isAdminMode: false,

	// Audio analyser / star boost
	audioCtx: null,
	analyser: null,
	dataArray: null,
	starBoostRaf: null,
	currentStarBoost: 0,

	// Sorting / filtering
	currentSortMode: null, // 'rating', 'date', 'listens', 'comments', 'title'
	currentSortDir: 'desc',
	filterUnrated: false,
	sortDebounceTimer: null,

	// Identity
	clientId: null, // initialised in main.js via getClientId()

	// Pending UI flow state
	pendingRating: null, // { songId, rating } stored when a guest tries to rate
	playbackAnalytics: null,
	commentPopupVid: null,
};

// Songs the current listener has heard (any version). Persisted in localStorage.
export const heardSongs = new Set(JSON.parse(localStorage.getItem('sv_heard') || '[]'));
// Individual versions the listener has heard or rated. Persisted in localStorage.
export const heardVersions = new Set(JSON.parse(localStorage.getItem('sv_heard_v') || '[]'));
// Version IDs where the user has passed the 75% listen threshold.
export const listenedEnough = new Set();

// Selected version index per song card: { [songBaseId]: index }
export const selectedVersions = {};
// Whether the user manually picked a version on a card (suppresses auto-promotion).
export const versionSelectionLocked = {};
