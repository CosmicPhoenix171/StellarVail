// Travelling-through-space star field. Anchored to the <canvas id="starfield">
// background; only animates while audio is playing.

import { state } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';
import {
	starColors,
	STAR_COUNT,
	LOW_PERF_STAR_COUNT,
	BASE_SPEED,
	BEAT_SPEED_MULTIPLIER,
} from '../config/constants.js';

let stars = [];
let starfieldCanvas = null;
let starfieldCtx = null;
let starfieldRaf = null;

export function initStarfield() {
	starfieldCanvas = document.getElementById('starfield');
	starfieldCtx = starfieldCanvas ? starfieldCanvas.getContext('2d') : null;
	if (!starfieldCanvas || !starfieldCtx) return;

	resizeStarfield();
	window.addEventListener('resize', resizeStarfield);

	// Initialize stars
	stars = [];
	const starCount = document.body.classList.contains('low-perf-mode') ? LOW_PERF_STAR_COUNT : STAR_COUNT;
	for (let i = 0; i < starCount; i++) {
		stars.push(createStar());
	}

	renderStarfieldFrame(false);
	if (audioPlayer) {
		audioPlayer.addEventListener('play', scheduleStarfieldAnimation);
		audioPlayer.addEventListener('pause', stopStarfieldAnimation);
		audioPlayer.addEventListener('ended', stopStarfieldAnimation);
	}
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopStarfieldAnimation();
			return;
		}
		if (audioPlayer && !audioPlayer.paused) scheduleStarfieldAnimation();
	});
	if (audioPlayer && !audioPlayer.paused) scheduleStarfieldAnimation();
}

function resizeStarfield() {
	if (!starfieldCanvas) return;
	starfieldCanvas.width = window.innerWidth;
	starfieldCanvas.height = window.innerHeight;
}

function createStar(fromCenter = false) {
	const canvas = starfieldCanvas;
	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;

	// Random angle from center — determines direction of travel
	const angle = Math.random() * Math.PI * 2;
	// Start distance — new stars start near center, initial stars are spread out
	const startDist = fromCenter ? (5 + Math.random() * 30) : Math.random() * Math.max(canvas.width, canvas.height) / 2;

	return {
		x: centerX + Math.cos(angle) * startDist,
		y: centerY + Math.sin(angle) * startDist,
		z: fromCenter ? (600 + Math.random() * 400) : Math.random() * 1000, // New stars start medium-far
		vx: Math.cos(angle),
		vy: Math.sin(angle),
		colorIndex: Math.floor(Math.random() * starColors.length),
		twinkle: Math.random() * Math.PI * 2,
	};
}

function renderStarfieldFrame(isPlaying) {
	if (!starfieldCanvas || !starfieldCtx) return;

	const ctx = starfieldCtx;
	const canvas = starfieldCanvas;
	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;
	const boost = state.currentStarBoost;

	// Clear canvas completely (transparent so background shows through)
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	for (let i = 0; i < stars.length; i++) {
		const star = stars[i];

		// Only move stars when music is playing
		if (isPlaying) {
			const speed = BASE_SPEED + (boost * BEAT_SPEED_MULTIPLIER);
			// Speed increases as star gets closer (perspective acceleration)
			const depthFactor = 1 + (1000 - star.z) / 800;
			const moveSpeed = speed * depthFactor;

			// Move star outward using stored velocity direction — faster outward movement
			star.x += star.vx * moveSpeed * 2.5;
			star.y += star.vy * moveSpeed * 2.5;
			star.z -= moveSpeed; // Come closer slower so stars reach edges
			star.twinkle += 0.1;

			// Only despawn when star is actually off screen — no z-based despawn
			if (star.x < -50 || star.x > canvas.width + 50 ||
				star.y < -50 || star.y > canvas.height + 50) {
				stars[i] = createStar(true);
				continue;
			}
		}

		// Size based on depth (closer = bigger) — reduced by 25%
		const size = Math.max(0.4, (1000 - star.z) / 267);

		// Twinkle effect
		const twinkle = 0.5 + Math.sin(star.twinkle) * 0.5;

		// Color shift with beat
		const colorShift = boost * 0.5;
		const colorIdx1 = star.colorIndex;
		const colorIdx2 = (star.colorIndex + 1) % starColors.length;
		const c1 = starColors[colorIdx1];
		const c2 = starColors[colorIdx2];

		const r = Math.round(c1.r + (c2.r - c1.r) * colorShift);
		const g = Math.round(c1.g + (c2.g - c1.g) * colorShift);
		const b = Math.round(c1.b + (c2.b - c1.b) * colorShift);

		// Draw star with glow
		const alpha = twinkle * (0.6 + boost * 0.4);

		// Outer glow
		const glowSize = size * (2 + boost * 2);
		const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, glowSize);
		gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
		gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

		ctx.beginPath();
		ctx.arc(star.x, star.y, glowSize, 0, Math.PI * 2);
		if (!document.body.classList.contains('low-perf-mode')) {
			ctx.fillStyle = gradient;
			ctx.fill();
		}

		// Core
		ctx.beginPath();
		ctx.arc(star.x, star.y, size, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
		ctx.fill();
	}

	void centerX; void centerY; // referenced for clarity even though unused
}

function animateStarfield() {
	starfieldRaf = null;
	const isPlaying = !!audioPlayer && !audioPlayer.paused && !document.hidden;
	renderStarfieldFrame(isPlaying);
	if (isPlaying) {
		starfieldRaf = requestAnimationFrame(animateStarfield);
	}
}

function scheduleStarfieldAnimation() {
	if (starfieldRaf || document.hidden) return;
	starfieldRaf = requestAnimationFrame(animateStarfield);
}

function stopStarfieldAnimation() {
	if (starfieldRaf) cancelAnimationFrame(starfieldRaf);
	starfieldRaf = null;
	renderStarfieldFrame(false);
}
