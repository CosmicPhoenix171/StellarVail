// Aurora wave canvas: animated wave bands + vertical "curtain" rays.
// Self-throttling: stops itself if it detects sustained low FPS.

import { state } from '../core/state.js';
import { AURORA_PALETTE } from '../config/constants.js';
import { disableAuroraEffects } from './hideUi.js';

export function initAuroraCanvas() {
	const canvas = document.getElementById('aurora-canvas');
	if (!canvas) return;
	if (document.body.classList.contains('low-perf-mode')) {
		document.body.classList.add('aurora-disabled');
		return;
	}
	if (state.auroraDisabled) {
		disableAuroraEffects();
		return;
	}
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	const FPS_SAMPLE_SIZE = 45;
	const FPS_THRESHOLD = 35;
	const LOW_FPS_GRACE_MS = 1800;
	const FRAME_DELTA_SPIKE_MS = 250;
	let auroraFrameId = null;
	let auroraStopped = false;
	let lastFrameTime = 0;
	let lowFpsSince = null;
	const frameDeltas = [];

	function stopAurora() {
		if (auroraStopped) return;
		auroraStopped = true;
		if (auroraFrameId) cancelAnimationFrame(auroraFrameId);
		ro.disconnect();
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		disableAuroraEffects();
	}

	function resize() {
		canvas.width = canvas.offsetWidth;
		canvas.height = canvas.offsetHeight;
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	const TWO_PI = Math.PI * 2;

	function makeWave(r, g, b, yFrac, amp, freq, speed, phase, lw, blur, alpha) {
		const [tr, tg, tb] = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
		// second independent color for the band gradient
		const c2 = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
		return {
			// primary color
			cr: r, cg: g, cb: b,
			tr, tg, tb,
			colorSpeed: 0.0003 + Math.random() * 0.0005,
			colorTimer: 600 + Math.floor(Math.random() * 600),
			// secondary color (the other end of the band)
			cr2: c2[0], cg2: c2[1], cb2: c2[2],
			tr2: c2[0], tg2: c2[1], tb2: c2[2],
			color2Speed: 0.0002 + Math.random() * 0.0004,
			color2Timer: 800 + Math.floor(Math.random() * 700),
			yFrac, amp, freq, speed, phase, lw, blur, alpha,
			driftVel: (Math.random() > 0.5 ? 1 : -1) * (0.001 + Math.random() * 0.002),
			driftTarget: 0,
			driftTimer: 400 + Math.floor(Math.random() * 600),
			driftOffset: 0,
			// color band scrolls independently
			bandOffset: Math.random(),
			bandSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.0008 + Math.random() * 0.0012),
		};
	}

	// Wave bands — from bottom (yFrac near 1.0) to top (yFrac near 0)
	const waves = [
		makeWave(0,   255, 140, 0.98, 8,  1.8, 0.004, 0,    14, 22, 0.85),
		makeWave(0,   240, 160, 0.93, 12, 2.2, 0.003, 1.1,  10, 18, 0.80),
		makeWave(0,   220, 190, 0.87, 16, 1.5, 0.0035, 2.3, 8,  16, 0.72),
		makeWave(30,  200, 210, 0.80, 20, 2.8, 0.0025, 0.7, 6,  14, 0.60),
		makeWave(0,   190, 255, 0.72, 26, 1.9, 0.002, 3.5,  5,  12, 0.42),
		makeWave(0,   210, 230, 0.64, 30, 2.4, 0.0018, 1.8, 4,  10, 0.30),
	];

	// Vertical rays — anchored to specific wave bands, rooted at a point on the wave.
	// Each ray's base x, y, and tilt are computed live from the wave each frame.
	const rays = Array.from({ length: 240 }, () => {
		// Attach to one of the lower 7 waves (the visible colored ones)
		const waveIndex = Math.floor(Math.random() * 7);
		return {
			waveIndex,
			xFrac: Math.random(),           // where along the wave (0–1)
			width: 1 + Math.random() * 2.5, // 1–3.5px crisp line
			glowWidth: 8 + Math.random() * 20,
			height: 60 + Math.random() * 160, // ray length in px
			opacity: 0.30 + Math.random() * 0.50,
			pulseSpeed: 0.004 + Math.random() * 0.009,
			pulsePhase: Math.random() * TWO_PI,
		};
	});

	function drawFrame(timestamp) {
		if (auroraStopped) return;
		if (document.hidden) {
			lastFrameTime = timestamp;
			auroraFrameId = requestAnimationFrame(drawFrame);
			return;
		}

		if (lastFrameTime) {
			const delta = timestamp - lastFrameTime;
			if (delta > 0 && delta < FRAME_DELTA_SPIKE_MS) {
				frameDeltas.push(delta);
				if (frameDeltas.length > FPS_SAMPLE_SIZE) frameDeltas.shift();

				if (frameDeltas.length === FPS_SAMPLE_SIZE) {
					const avgDelta = frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length;
					const avgFps = 1000 / avgDelta;
					if (avgFps < FPS_THRESHOLD) {
						lowFpsSince = lowFpsSince ?? timestamp;
						if (timestamp - lowFpsSince >= LOW_FPS_GRACE_MS) {
							stopAurora();
							return;
						}
					} else {
						lowFpsSince = null;
					}
				}
			}
		}
		lastFrameTime = timestamp;

		const w = canvas.width;
		const h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		// Build a lookup: waveIndex → rays attached to that wave
		const raysByWave = new Map();
		rays.forEach((ray) => {
			if (!raysByWave.has(ray.waveIndex)) raysByWave.set(ray.waveIndex, []);
			raysByWave.get(ray.waveIndex).push(ray);
		});

		// Draw wave bands — fill, then rays clipped inside the fill, then stroke on top
		waves.forEach((w_, wi) => {
			// ── Drift: ease velocity toward target, randomly flip direction ──
			w_.driftTimer--;
			if (w_.driftTimer <= 0) {
				// pick a new target velocity in a random direction, slow down first
				w_.driftTarget = (Math.random() > 0.5 ? 1 : -1) * (0.001 + Math.random() * 0.002);
				w_.driftTimer = 500 + Math.floor(Math.random() * 600);
			}
			// easing: drift velocity creeps toward target (slows through zero on direction change)
			w_.driftVel += (w_.driftTarget - w_.driftVel) * 0.012;
			w_.driftOffset += w_.driftVel;

			// ── Color 1: lerp toward target ──
			w_.colorTimer--;
			if (w_.colorTimer <= 0) {
				const [tr, tg, tb] = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
				w_.tr = tr; w_.tg = tg; w_.tb = tb;
				w_.colorTimer = 400 + Math.floor(Math.random() * 500);
			}
			w_.cr += (w_.tr - w_.cr) * w_.colorSpeed;
			w_.cg += (w_.tg - w_.cg) * w_.colorSpeed;
			w_.cb += (w_.tb - w_.cb) * w_.colorSpeed;

			// ── Color 2: separate lerp for the band's second color ──
			w_.color2Timer--;
			if (w_.color2Timer <= 0) {
				const [tr2, tg2, tb2] = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
				w_.tr2 = tr2; w_.tg2 = tg2; w_.tb2 = tb2;
				w_.color2Timer = 500 + Math.floor(Math.random() * 600);
			}
			w_.cr2 += (w_.tr2 - w_.cr2) * w_.color2Speed;
			w_.cg2 += (w_.tg2 - w_.cg2) * w_.color2Speed;
			w_.cb2 += (w_.tb2 - w_.cb2) * w_.color2Speed;

			const r  = Math.round(w_.cr),  g  = Math.round(w_.cg),  b  = Math.round(w_.cb);
			const r2 = Math.round(w_.cr2), g2 = Math.round(w_.cg2), b2 = Math.round(w_.cb2);

			w_.phase += w_.speed;
			const yBase = h * w_.yFrac;

			// Collect wave points once — include driftOffset in phase
			const pts = [];
			const totalPhase = w_.phase + w_.driftOffset;
			for (let x = 0; x <= w; x += 2) {
				pts.push([x, yBase + Math.sin((x / w) * w_.freq * TWO_PI + totalPhase) * w_.amp]);
			}

			// Band center scrolls left/right with the wave's drift (0–1, wrapping)
			w_.bandOffset = ((w_.bandOffset + w_.bandSpeed) % 1.0 + 1.0) % 1.0;
			const bandPos = w_.bandOffset;

			// Build fill path (wave line → bottom-right → bottom-left → close)
			const buildFillPath = () => {
				ctx.beginPath();
				pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(w, h);
				ctx.lineTo(0, h);
				ctx.closePath();
			};

			const buildRayClipPath = () => {
				ctx.beginPath();
				pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(w, 0);
				ctx.lineTo(0, 0);
				ctx.closePath();
			};

			// Fill: blend horizontal color band with vertical fade — all in one gradient pair.
			// Use a canvas offscreen trick: draw with horizontal grad, alpha driven by vertical position.
			buildFillPath();
			const bp0 = Math.max(0, bandPos - 0.25);
			const bp1 = bandPos;
			const bp2 = Math.min(1, bandPos + 0.25);

			const simpleFill = ctx.createLinearGradient(0, 0, w, 0);
			simpleFill.addColorStop(0,  `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			if (bp0 > 0) simpleFill.addColorStop(bp0, `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			simpleFill.addColorStop(bp1, `rgba(${r},${g},${b},${(w_.alpha * 0.55).toFixed(3)})`);
			if (bp2 < 1) simpleFill.addColorStop(bp2, `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			simpleFill.addColorStop(1,  `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			ctx.fillStyle = simpleFill;
			ctx.fill();

			// Rays: clipped above the hard line so they rise into the curtain
			const waveRays = raysByWave.get(wi);
			if (waveRays) {
				ctx.save();
				buildRayClipPath();
				ctx.clip();

				const raySegments = waveRays.map((ray) => {
					ray.pulsePhase += ray.pulseSpeed;
					const op = ray.opacity * (0.5 + 0.5 * Math.sin(ray.pulsePhase));
					const xPos = ray.xFrac * w;
					const rootY = yBase + Math.sin((xPos / w) * w_.freq * TWO_PI + totalPhase) * w_.amp;
					const topY = rootY - ray.height;
					return { ray, op, xPos, rootY, rayH: ray.height, topY };
				}).sort((a, b) => a.xPos - b.xPos);

				// Continuous curtain fabric: bottom follows the bright edge roots, top follows ripple heights.
				if (raySegments.length >= 2) {
					let avgOpacity = 0;
					let gapOpacity = 0;
					for (let i = 0; i < raySegments.length; i++) {
						avgOpacity += raySegments[i].op;
						if (i < raySegments.length - 1) {
							const gap = raySegments[i + 1].xPos - raySegments[i].xPos;
							const maxGap = w * 0.07;
							gapOpacity += Math.max(0, 1 - gap / maxGap);
						}
					}
					avgOpacity /= raySegments.length;
					gapOpacity /= Math.max(1, raySegments.length - 1);
					const sheetAlpha = Math.max(0.08, avgOpacity * (0.38 + w_.alpha * 0.78) * gapOpacity);

					const fabricGrad = ctx.createLinearGradient(0, yBase, 0, Math.min(...raySegments.map((segment) => segment.topY)));
					fabricGrad.addColorStop(0, `rgba(${r},${g},${b},${sheetAlpha.toFixed(3)})`);
					fabricGrad.addColorStop(0.45, `rgba(${r},${g},${b},${(sheetAlpha * 0.55).toFixed(3)})`);
					fabricGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);

					ctx.shadowBlur = 18;
					ctx.shadowColor = `rgba(${r},${g},${b},${(sheetAlpha * 0.85).toFixed(3)})`;
					ctx.fillStyle = fabricGrad;
					ctx.beginPath();
					ctx.moveTo(raySegments[0].xPos, raySegments[0].rootY);
					for (let i = 1; i < raySegments.length; i++) {
						const prev = raySegments[i - 1];
						const curr = raySegments[i];
						const controlX = (prev.xPos + curr.xPos) / 2;
						const controlY = (prev.rootY + curr.rootY) / 2;
						ctx.quadraticCurveTo(prev.xPos, prev.rootY, controlX, controlY);
					}
					const last = raySegments[raySegments.length - 1];
					ctx.lineTo(last.xPos, last.rootY);
					ctx.lineTo(last.xPos, last.topY);
					for (let i = raySegments.length - 2; i >= 0; i--) {
						const next = raySegments[i + 1];
						const curr = raySegments[i];
						const controlX = (next.xPos + curr.xPos) / 2;
						const controlY = (next.topY + curr.topY) / 2;
						ctx.quadraticCurveTo(next.xPos, next.topY, controlX, controlY);
					}
					ctx.lineTo(raySegments[0].xPos, raySegments[0].topY);
					ctx.closePath();
					ctx.fill();
					ctx.shadowBlur = 0;
				}

				raySegments.forEach(({ ray, op, xPos, rootY, rayH }) => {
					ctx.save();
					ctx.translate(xPos, rootY);
					// no rotation — rays stay perfectly vertical

					// Glow halo — rises upward from the bottom edge
					const haloGrad = ctx.createLinearGradient(0, 0, 0, -rayH);
					haloGrad.addColorStop(0,   `rgba(${r},${g},${b},${(op * 0.40).toFixed(3)})`);
					haloGrad.addColorStop(0.5, `rgba(${r},${g},${b},${(op * 0.15).toFixed(3)})`);
					haloGrad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
					ctx.fillStyle = haloGrad;
					ctx.fillRect(-ray.glowWidth / 2, -rayH, ray.glowWidth, rayH);

					// Crisp ripple line rising upward
					const lineGrad = ctx.createLinearGradient(0, 0, 0, -rayH);
					lineGrad.addColorStop(0,    `rgba(${r},${g},${b},${op.toFixed(3)})`);
					lineGrad.addColorStop(0.55, `rgba(${r},${g},${b},${(op * 0.35).toFixed(3)})`);
					lineGrad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
					ctx.strokeStyle = lineGrad;
					ctx.lineWidth = ray.width;
					ctx.beginPath();
					ctx.moveTo(0, 0);
					ctx.lineTo(0, -rayH);
					ctx.stroke();

					ctx.restore();
				});

				ctx.restore(); // remove clip
			}

			// Stroke: horizontal band gradient for the wave line itself
			ctx.beginPath();
			pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
			const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
			strokeGrad.addColorStop(0,  `rgba(${r2},${g2},${b2},${w_.alpha})`);
			if (bp0 > 0) strokeGrad.addColorStop(bp0, `rgba(${r2},${g2},${b2},${w_.alpha})`);
			strokeGrad.addColorStop(bp1, `rgba(${r},${g},${b},${Math.min(1, w_.alpha * 1.4).toFixed(3)})`);
			if (bp2 < 1) strokeGrad.addColorStop(bp2, `rgba(${r2},${g2},${b2},${w_.alpha})`);
			strokeGrad.addColorStop(1,  `rgba(${r2},${g2},${b2},${w_.alpha})`);
			ctx.shadowBlur = w_.blur;
			ctx.shadowColor = `rgba(${r},${g},${b},${w_.alpha})`;
			ctx.strokeStyle = strokeGrad;
			ctx.lineWidth = w_.lw;
			ctx.lineCap = 'round';
			ctx.stroke();
			ctx.shadowBlur = 0;
		});

		auroraFrameId = requestAnimationFrame(drawFrame);
	}

	auroraFrameId = requestAnimationFrame(drawFrame);
}
