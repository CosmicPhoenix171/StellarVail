// App-wide constants. Pure data, no side effects.

// Usernames that get admin powers (all ratings visible, listen count not incremented).
export const ADMIN_USERNAMES = ['Phoenix'];

// Legacy ID mapping - maps filename to old Firebase ID to preserve ratings/listens.
export const legacyIdMap = {
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

export const SHARE_TRACK_QUERY_PARAM = 'track';
export const basePath = '';

// Aurora canvas color palette
export const AURORA_PALETTE = [
	[0,   255, 140],  // green
	[0,   240, 160],  // green-teal
	[0,   220, 190],  // teal
	[30,  200, 210],  // teal-cyan
	[0,   190, 255],  // cyan
	[0,   210, 230],  // cyan-blue
	[40,  130, 255],  // blue
	[100, 80,  255],  // blue-purple
	[160, 0,   255],  // purple
	[220, 60,  200],  // pink
];

// Starfield colors that shift with the beat.
export const starColors = [
	{ r: 255, g: 255, b: 255 },  // White
	{ r: 0, g: 243, b: 255 },    // Cyan
	{ r: 189, g: 0, b: 255 },    // Purple
	{ r: 255, g: 0, b: 255 },    // Magenta
	{ r: 255, g: 200, b: 255 },  // Pink-white
];

export const STAR_COUNT = 200;
export const LOW_PERF_STAR_COUNT = 80;
export const BASE_SPEED = 0.3;
export const BEAT_SPEED_MULTIPLIER = 2;
