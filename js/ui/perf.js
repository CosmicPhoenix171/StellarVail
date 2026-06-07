// Always-on low-performance mode flag (kept for compatibility with
// CSS that targets `.low-perf-mode`).

export function initPerfMode() {
	document.body.classList.add('low-perf-mode');
}
