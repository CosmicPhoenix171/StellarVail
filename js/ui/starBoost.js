// Audio-reactive star boost: hooks WebAudio into the <audio> element and
// publishes a CSS variable that drives the background star pulse.

import { state } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';

export async function ensureAudioAnalyser() {
	if (state.audioCtx && state.analyser && state.dataArray) return;

	const AudioContext = window.AudioContext || window.webkitAudioContext;
	if (!AudioContext) throw new Error('Web Audio not supported');

	state.audioCtx = state.audioCtx || new AudioContext();
	await state.audioCtx.resume();

	const source = state.audioCtx.createMediaElementSource(audioPlayer);
	state.analyser = state.audioCtx.createAnalyser();
	state.analyser.fftSize = 256;
	const bufferLength = state.analyser.frequencyBinCount;
	state.dataArray = new Uint8Array(bufferLength);

	// Connect: source -> analyser -> destination
	source.connect(state.analyser);
	state.analyser.connect(state.audioCtx.destination);
}

export function startStarBoost() {
	if (!state.analyser || !state.dataArray) return;

	if (state.starBoostRaf) cancelAnimationFrame(state.starBoostRaf);

	const tick = () => {
		if (audioPlayer.paused) {
			state.currentStarBoost = 0;
			document.documentElement.style.setProperty('--star-boost', '0');
			state.starBoostRaf = requestAnimationFrame(tick);
			return;
		}

		state.analyser.getByteFrequencyData(state.dataArray);
		// Focus on low/mid bins for beat-like energy (first 64 bins)
		const bins = Math.min(64, state.dataArray.length);
		let sum = 0;
		for (let i = 0; i < bins; i++) sum += state.dataArray[i];
		const avg = sum / bins;
		// Map average magnitude to a stronger visible boost (0 to ~2)
		const boost = Math.min(2, (avg / 255) * 3);
		state.currentStarBoost = boost;
		document.documentElement.style.setProperty('--star-boost', boost.toFixed(3));

		state.starBoostRaf = requestAnimationFrame(tick);
	};

	state.starBoostRaf = requestAnimationFrame(tick);
}

export function stopStarBoost() {
	if (state.starBoostRaf) cancelAnimationFrame(state.starBoostRaf);
	state.starBoostRaf = null;
	state.currentStarBoost = 0;
	document.documentElement.style.setProperty('--star-boost', '0');
}
