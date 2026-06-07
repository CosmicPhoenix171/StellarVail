// Shared DOM references. Resolved once at module load.
// These elements are part of the static index.html shell and exist for the
// lifetime of the page.

export const audioPlayer = document.getElementById('audio-player');
export const songsContainer = document.getElementById('songs-container');
export const playerBar = document.querySelector('.player-bar');
