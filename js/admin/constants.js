// Admin-only constants. Shared utility constants (ADMIN_USERNAMES,
// legacyIdMap) come from ../config/constants.js.

export const ADMIN_SONG_CACHE_KEY = 'sv_admin_song_cache_v1';

// Explicit alias map for songs whose Firebase data lives under historical
// IDs that can't be derived from the current filename (file renames, legacy
// songN keys that no longer match the current filename, etc.). Each entry
// maps a CANONICAL destination ID to the list of historical source IDs the
// migration should pull from. Used by getSongVersionSourceIds + "Pull Old
// Data".
export const aliasIdMap = {
	// Romance.exe V2 — file renamed to RomanceV3.exe.mp3
	'romancev3exemp3': ['romanceexe-v2', 'romanceexe-v2-v3'],
	// Demon in Disguise — legacy "Demons.wav" key, file is now Demon in Disguise V2.mp3
	'demon-in-disguise-v2mp3': ['song8'],
	// Hide Away V2 — legacy "Hide Away.wav" key, folder/file is now Hide Away V2.wav
	'hide-away-v2': ['song13'],
};
