// The Busy page: Night town beside a page that keeps its own thread busy, as a news page with a live
// feed does. It scrolls an article, types into a search box, adds a card to a live feed twice a
// second, and runs CSS animations: a ticker, a progress bar that grows, shimmering placeholders and
// a pulsing badge. A visitor can scroll and type too. null3D draws the town in its workers, and
// three.js on the page's thread, as its official examples run, so the page's work and the engine's
// frames share one thread in three.js only. The stats panel shows the page thread's long tasks and
// its input delay for both engines.
//
// `dressBusyPage` lays the page out around a comparison's canvas and starts its work. It brings its
// own styles, so the clone's examples page and the website both show it the same way.

/** Words that the article, the feed and the typing draw from. */
const WORDS =
	'rain neon tram corner lantern harbor late shift market bridge window signal avenue alley quiet engine light street night city crowd bus station rooftop steam glow traffic umbrella puddle reflection music cafe'.split(
		' ',
	);

/** A sentence of `count` words from a seeded walk through the word list. */
function sentence(seed: number, count: number): string {
	const words: string[] = [];
	let s = seed;
	for (let i = 0; i < count; i++) {
		s = (s * 1103515245 + 12345) % 2147483648;
		words.push(WORDS[s % WORDS.length] as string);
	}
	const text = words.join(' ');
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

const STYLES = `
.busy-host { position: absolute; inset: 0; }
.busy-host:not(.busy-fixed) > canvas { right: 38% !important; width: auto !important; }
.busy-host.busy-fixed { position: relative; inset: auto; display: flex; width: max-content; }
.busy-fixed .busy { position: relative; width: 480px; }
.busy { position: absolute; top: 0; right: 0; bottom: 0; width: 38%; display: flex; flex-direction: column;
	background: #f4f1ea; color: #1d1d1f; font: 14px/1.5 Georgia, 'Times New Roman', serif; overflow: hidden; }
.busy header { padding: 0.6rem 0.9rem 0.4rem; border-bottom: 2px solid #1d1d1f; }
.busy h2 { margin: 0; font-size: 1.35rem; letter-spacing: 0.02em; }
.busy .busy-meta { display: flex; align-items: center; gap: 0.5rem; font: 12px system-ui, sans-serif; color: #5d5a54; }
.busy .busy-live { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: #d7263d;
	animation: busy-pulse 1.1s ease-in-out infinite; }
.busy .busy-ticker { overflow: hidden; white-space: nowrap; background: #1d1d1f; color: #f4f1ea; font: 12px system-ui, sans-serif; }
.busy .busy-ticker span { display: inline-block; padding: 0.25rem 0; animation: busy-ticker 22s linear infinite; }
.busy .busy-progress { height: 3px; background: #d7263d; animation: busy-progress 4s ease-in-out infinite; }
.busy .busy-search { margin: 0.5rem 0.9rem; padding: 0.35rem 0.5rem; font: 14px system-ui, sans-serif; border: 1px solid #b9b3a7;
	border-radius: 4px; background: #fff; }
.busy .busy-body { flex: 1; display: grid; grid-template-columns: 3fr 2fr; gap: 0.75rem; padding: 0 0.9rem 0.75rem; min-height: 0; }
.busy article { overflow-y: auto; padding-right: 0.25rem; }
.busy article p { margin: 0 0 0.7rem; }
.busy article h3 { margin: 0.4rem 0; font-size: 1.05rem; }
.busy .busy-feed { overflow: hidden; font: 12px/1.4 system-ui, sans-serif; display: flex; flex-direction: column; gap: 0.4rem; }
.busy .busy-card { padding: 0.4rem 0.5rem; background: #fff; border-left: 3px solid #d7263d; border-radius: 3px;
	animation: busy-in 0.35s ease-out; }
.busy .busy-shimmer { height: 0.6rem; margin: 0.25rem 0; border-radius: 3px;
	background: linear-gradient(90deg, #e3ded3 0%, #f7f4ee 50%, #e3ded3 100%); background-size: 200% 100%;
	animation: busy-shimmer 1.4s linear infinite; }
@keyframes busy-pulse { 50% { opacity: 0.25; transform: scale(0.7); } }
@keyframes busy-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes busy-progress { 0% { width: 0; } 70% { width: 100%; } 100% { width: 100%; opacity: 0; } }
@keyframes busy-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes busy-in { from { opacity: 0; transform: translateY(-6px); } }
@media (max-width: 767.98px) {
	.busy-host:not(.busy-fixed) > canvas { right: 0 !important; bottom: 45% !important; height: auto !important; }
	.busy-host:not(.busy-fixed) .busy { top: 55%; width: 100%; }
}
`;

import type { Comparison } from '../comparisons';

/** The page's work, started; `stop` ends it and removes the page. */
export interface BusyPage {
	stop(): void;
}

/** How often the page's own code runs. */
const FEED_MS = 500;
const TYPE_MS = 90;
/** Pixels the article scrolls each frame while no one scrolls it. */
const SCROLL_STEP = 0.6;

/**
 * Lays out the Busy page around a canvas in `stage`, and starts its work. The canvas keeps the left
 * part of the stage, or the top part on a narrow screen. With `fixed`, the canvas keeps its own
 * size, and the page stands beside it at the same height, as the test page measures it.
 */
export function dressBusyPage(
	stage: HTMLElement,
	canvas: HTMLCanvasElement,
	fixed = false,
): BusyPage {
	const style = document.createElement('style');
	style.textContent = STYLES;
	document.head.append(style);
	const host = document.createElement('div');
	host.className = fixed ? 'busy-host busy-fixed' : 'busy-host';
	canvas.replaceWith(host);
	host.append(canvas);
	if (!stage.contains(host)) stage.append(host);

	const page = document.createElement('section');
	page.className = 'busy';
	page.setAttribute('aria-label', 'A busy page beside the scene');
	const headlines = Array.from({ length: 8 }, (_, i) => sentence(i + 3, 6)).join('  ·  ');
	page.innerHTML = `
		<header>
			<h2>The Evening Edition</h2>
			<div class="busy-meta"><span class="busy-live"></span> Live coverage, updated every few seconds</div>
		</header>
		<div class="busy-ticker"><span>${headlines}  ·  ${headlines}</span></div>
		<div class="busy-progress"></div>
		<input class="busy-search" type="search" placeholder="Search the edition" aria-label="Search the edition" />
		<div class="busy-body">
			<article></article>
			<div class="busy-feed" aria-live="off"></div>
		</div>`;
	host.append(page);
	if (fixed) page.style.height = `${canvas.clientHeight}px`;
	const article = page.querySelector('article') as HTMLElement;
	for (let k = 0; k < 40; k++) {
		const heading = document.createElement('h3');
		heading.textContent = sentence(k * 31 + 7, 5);
		article.append(heading);
		for (let p = 0; p < 3; p++) {
			const paragraph = document.createElement('p');
			paragraph.textContent = Array.from({ length: 4 }, (_, s) =>
				sentence(k * 97 + p * 13 + s, 12),
			).join(' ');
			article.append(paragraph);
		}
		const shimmer = document.createElement('div');
		shimmer.className = 'busy-shimmer';
		article.append(shimmer);
	}
	const feed = page.querySelector('.busy-feed') as HTMLElement;
	const search = page.querySelector('.busy-search') as HTMLInputElement;

	// The article scrolls itself, and stops while a visitor scrolls it.
	let held = 0;
	const hold = () => {
		held = performance.now() + 3000;
	};
	article.addEventListener('wheel', hold, { passive: true });
	article.addEventListener('touchstart', hold, { passive: true });
	let frame = 0;
	const scroll = () => {
		if (performance.now() > held) {
			article.scrollTop += SCROLL_STEP;
			if (article.scrollTop + article.clientHeight >= article.scrollHeight - 1)
				article.scrollTop = 0;
		}
		frame = requestAnimationFrame(scroll);
	};
	frame = requestAnimationFrame(scroll);

	// The live feed: a new card at the top twice a second, the oldest one dropped.
	let cards = 0;
	const feedTimer = setInterval(() => {
		const card = document.createElement('div');
		card.className = 'busy-card';
		const time = new Date().toLocaleTimeString('en-GB');
		card.innerHTML = `<strong>${time}</strong><br>${sentence(cards++ * 17 + 5, 9)}`;
		feed.prepend(card);
		while (feed.children.length > 30) feed.lastElementChild?.remove();
	}, FEED_MS);

	// The search box types a query letter by letter, and stops while a visitor types.
	let typed = 0;
	let query = sentence(1, 4);
	search.addEventListener('keydown', () => {
		typed = -1;
	});
	const typeTimer = setInterval(() => {
		if (typed < 0) return;
		typed++;
		if (typed > query.length + 12) {
			typed = 0;
			query = sentence(typed + query.length, 4);
		}
		search.value = query.slice(0, Math.min(typed, query.length));
	}, TYPE_MS);

	return {
		stop() {
			cancelAnimationFrame(frame);
			clearInterval(feedTimer);
			clearInterval(typeTimer);
			page.remove();
			style.remove();
		},
	};
}

/**
 * Dresses a comparison's stage, where the comparison asks for the busy page, and returns its work,
 * or null for a comparison that draws on a plain stage.
 */
export function dressStage(
	comparison: Comparison,
	stage: HTMLElement,
	canvas: HTMLCanvasElement,
	fixed = false,
): BusyPage | null {
	return comparison.busyPage ? dressBusyPage(stage, canvas, fixed) : null;
}
