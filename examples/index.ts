// The examples page of a clone. A sidebar lists the demos by group, and the panel beside it runs
// the demo that ?demo=<name> names, or the comparison with three.js that ?compare=<name> names
// (compare-page.ts), on a canvas that fills the panel. Each link loads the page
// afresh, so the engine of the last demo stops with its workers and memory; the sidebar keeps its
// scroll position across that load. Without ?demo=, the
// panel shows a short welcome. In a narrow window, the sidebar is a drawer that the menu button
// opens. The engine reads its own switches from the address: ?hold=2 draws the frame at 2 seconds
// that the demo's image test holds, and ?gpu=webgl2 forces a GPU path. The page's links are
// relative, so it runs under any address prefix. It is one layout of the demos: another page can
// show them its own way with the list and startDemo.

import { COMPARE_GROUP, COMPARISONS } from './compare/comparisons';
import { runComparison } from './compare-page';
import { DEMO_GROUPS, DEMOS, type Demo } from './demos';
import { startDemo } from './lib/run';
import { sourceUrl } from './lib/source';

const params = new URLSearchParams(location.search);
const name = params.get('demo');
const current = DEMOS.find((demo) => demo.name === name);
const compareName = params.get('compare');
const comparison = COMPARISONS.find((entry) => entry.name === compareName);

const nav = document.querySelector('nav') as HTMLElement;
const menu = document.querySelector('.menu') as HTMLButtonElement;
const backdrop = document.querySelector('.backdrop') as HTMLElement;
const stage = document.querySelector('main') as HTMLElement;
/** Matches while the window is wide enough to show the sidebar beside the panel. */
const wide = matchMedia('(min-width: 768px)');

/** A new element with its text and, for a link, its address. */
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', href?: string) {
	const node = document.createElement(tag);
	node.textContent = text;
	if (href !== undefined) node.setAttribute('href', href);
	return node;
}

/** The address of a demo's page. */
const demoLink = (demo: Demo) => `?demo=${demo.name}`;

/**
 * The sidebar's place in this tab. Each link loads the page afresh, which is what stops the last
 * demo's engine and its workers, so the place is kept here rather than in the page.
 */
const NAV_SCROLL = 'null3d.demos.navScroll';

/** Puts the sidebar back where this tab left it, when it has been here before. */
function restoreNavScroll(): void {
	try {
		const saved = sessionStorage.getItem(NAV_SCROLL);
		if (saved !== null) nav.scrollTop = Number(saved);
	} catch {
		// A browser that refuses storage opens the sidebar at its top.
	}
}

/** Remembers the sidebar's place, so the next demo's load keeps it. */
function rememberNavScroll(): void {
	nav.addEventListener(
		'scroll',
		() => {
			try {
				sessionStorage.setItem(NAV_SCROLL, String(nav.scrollTop));
			} catch {
				// A browser that refuses storage opens the sidebar at its top next time.
			}
		},
		{ passive: true },
	);
}

/** A demo's title, then its scene as a smaller sub-title under it, on its own line. */
function heading(demo: Demo): (string | HTMLElement)[] {
	const name = element('span', demo.title);
	name.className = 'name';
	const scene = element('span', demo.scene);
	scene.className = 'scene';
	return [name, scene];
}

/** Lists the demos in the sidebar, group by group, and marks the one that runs. */
function listDemos(): void {
	for (const group of DEMO_GROUPS) {
		const list = element('ul');
		// The comparisons with three.js have a group of their own, each linked to its null3D page.
		if (group === COMPARE_GROUP) {
			for (const entry of COMPARISONS) {
				const link = element('a', entry.title, `?compare=${entry.name}`);
				if (entry === comparison) link.setAttribute('aria-current', 'page');
				const item = element('li');
				item.append(link);
				list.append(item);
			}
		}
		for (const demo of DEMOS) {
			if (demo.group !== group) continue;
			const link = element('a', '', demoLink(demo));
			link.append(...heading(demo));
			if (demo.assets) link.title = demo.assets;
			if (demo === current) link.setAttribute('aria-current', 'page');
			const item = element('li');
			item.append(link);
			list.append(item);
		}
		if (list.childElementCount > 0) nav.append(element('h2', group), list);
	}
}

/** Opens or closes the drawer that holds the sidebar in a narrow window. */
function setDrawer(open: boolean, focusMenu = false): void {
	menu.setAttribute('aria-expanded', String(open));
	nav.classList.toggle('open', open);
	backdrop.hidden = !open;
	// The panel takes no focus or clicks while the drawer covers it.
	stage.inert = open;
	if (open) {
		const link = nav.querySelector<HTMLElement>('[aria-current]') ?? nav.querySelector('li a');
		link?.focus();
	} else if (focusMenu) menu.focus();
}

const drawerOpen = () => nav.classList.contains('open');

function handleDrawer(): void {
	menu.addEventListener('click', () => setDrawer(!drawerOpen()));
	backdrop.addEventListener('click', () => setDrawer(false, true));
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && drawerOpen()) setDrawer(false, true);
	});
	// A pick closes the drawer while the demo's page loads.
	nav.addEventListener('click', (event) => {
		if ((event.target as Element).closest('a')) setDrawer(false);
	});
	wide.addEventListener('change', () => setDrawer(false));
}

/** Shows a short welcome in the panel, after a line about a missing demo when there is one. */
function welcome(missing?: string): void {
	const box = element('div');
	box.className = 'welcome';
	if (missing !== undefined) box.append(element('p', `There is no demo named ${missing}.`));
	box.append(
		element('h1', 'null3D demos'),
		element(
			'p',
			'Each demo is one sketch, of under 150 lines, that shows what the engine does. Pick one from the list of demos to run it live.',
		),
		element('p', "Add ?gpu=webgl2 or ?gpu=compat to a demo's address to force a GPU path."),
	);
	stage.append(box);
}

/**
 * Runs the demo on a canvas that fills the panel, with a caption at its top left. The caption shows
 * the demo's title and summary, with a link to its code on the main branch, and starts folded.
 */
async function runDemo(demo: Demo): Promise<void> {
	document.title = `${demo.title} · ${demo.scene}: null3D demos`;
	const canvas = element('canvas');
	// The labels' layer covers the canvas, and lets the pointer through to it.
	const labels = element('div');
	labels.className = 'labels';
	const caption = element('details');
	caption.className = 'caption';
	const title = element('summary');
	const h1 = element('h1');
	h1.append(...heading(demo));
	// The chevron floats at the top right of the summary, in place of the native marker. It points
	// down while the caption is folded and up while it is open, and the summary toggles it once.
	const chevron = element('span');
	chevron.className = 'caption__chevron';
	chevron.setAttribute('aria-hidden', 'true');
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('width', '18');
	svg.setAttribute('height', '18');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', 'M6 9l6 6 6-6');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.append(path);
	chevron.append(svg);
	title.append(h1, chevron);
	caption.append(title, element('p', demo.summary));
	const code = element('a', 'View code', sourceUrl(demo));
	code.target = '_blank';
	code.rel = 'noopener';
	const links = element('p');
	links.className = 'quiet';
	links.append(code);
	caption.append(links);
	stage.append(canvas, labels, caption);
	// A showcase scene's choices, such as its time of day, sit in a bar at the bottom of the panel.
	const choices = demo.choices && !params.has('hold') ? element('div') : undefined;
	if (choices) {
		choices.className = 'choices';
		stage.append(choices);
	}
	// The help that a showcase scene posts: its keys and the camera mode. A held frame has none.
	const hud = !params.has('hold') ? element('div') : undefined;
	if (hud) {
		hud.className = 'hud';
		hud.hidden = true;
		stage.append(hud);
	}
	try {
		await startDemo({ canvas, demo, labels, choices, hud });
	} catch (error) {
		const message = element('p', error instanceof Error ? error.message : String(error));
		message.className = 'error';
		caption.append(message);
		caption.open = true;
	}
}

listDemos();
restoreNavScroll();
rememberNavScroll();
handleDrawer();
if (comparison) void runComparison(stage, comparison);
else if (current) void runDemo(current);
else welcome(compareName ?? name ?? undefined);
