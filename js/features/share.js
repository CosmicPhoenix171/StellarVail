// Sharing & deep-link helpers: building share URLs, copying to clipboard,
// and consuming the ?track=… query parameter on load.

import { state, selectedVersions } from '../core/state.js';
import { SHARE_TRACK_QUERY_PARAM } from '../config/constants.js';
import { defaultVersionIndex, versionId, selectVersion } from './versions.js';
import { selectSong } from './nowPlaying.js';
import { resolveSongAndVersion, loadSongToPlayer } from './audio.js';

export function getSharedTrackIdFromUrl() {
	const params = new URLSearchParams(window.location.search);
	return params.get(SHARE_TRACK_QUERY_PARAM)?.trim() || '';
}

export function normalizeShareSlug(value, stripExtension = false) {
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

export function buildVersionShareSlug(song, versionIndex) {
	const vi = versionIndex ?? (selectedVersions[song.id] ?? defaultVersionIndex(song));
	if (!song.versions || song.versions.length <= 1 || vi === 0) return '';
	return normalizeShareSlug(song.versions[vi].label || `v${vi + 1}`);
}

export function buildTrackShareUrl(songBaseId, versionIndex) {
	const song = state.songsData.find((entry) => entry.id === songBaseId);
	if (!song) return '';
	const versionSlug = buildVersionShareSlug(song, versionIndex);
	const baseUrl = new URL(window.location.href);
	baseUrl.search = '';
	baseUrl.hash = '';
	const appRoot = /\.[a-z0-9]+$/i.test(baseUrl.pathname)
		? baseUrl.pathname.replace(/[^/]+$/, '')
		: (baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`);
	const url = new URL(`music/${encodeURIComponent(song.folder)}/`, `${baseUrl.origin}${appRoot}`);
	if (versionSlug) {
		url.searchParams.set('v', versionSlug);
	}
	return url.toString();
}

function fallbackCopyText(text) {
	const input = document.createElement('textarea');
	input.value = text;
	input.setAttribute('readonly', '');
	input.style.position = 'absolute';
	input.style.left = '-9999px';
	document.body.appendChild(input);
	input.select();
	document.execCommand('copy');
	document.body.removeChild(input);
}

export async function copySongLink(songBaseId, versionIndex, event) {
	event?.stopPropagation();
	const shareButton = event?.currentTarget || event?.target?.closest('.share-button');
	const shareUrl = buildTrackShareUrl(songBaseId, versionIndex);
	if (!shareUrl) return;

	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(shareUrl);
		} else {
			fallbackCopyText(shareUrl);
		}
		if (shareButton) {
			const originalLabel = shareButton.dataset.label || shareButton.textContent;
			shareButton.dataset.label = originalLabel;
			shareButton.textContent = 'Copied!';
			shareButton.classList.add('copied');
			window.setTimeout(() => {
				shareButton.textContent = shareButton.dataset.label || 'Share';
				shareButton.classList.remove('copied');
			}, 1600);
		}
	} catch (error) {
		console.error('Could not copy share link:', error);
	}
}

export function openSharedTrackFromUrl() {
	const trackId = getSharedTrackIdFromUrl();
	if (!trackId) return false;

	const resolved = resolveSongAndVersion(trackId);
	if (!resolved) return false;

	selectedVersions[resolved.song.id] = resolved.vi;
	if (resolved.song.versions?.length) {
		selectVersion(resolved.song.id, resolved.vi);
	} else {
		selectSong(resolved.song.id);
	}
	loadSongToPlayer(resolved.song.id, resolved.vi);
	return true;
}
