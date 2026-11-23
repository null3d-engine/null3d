// The examples page of a clone. A sidebar lists the demos by group, and the panel beside it runs
// the demo that ?demo=<name> names, or the comparison with three.js that ?compare=<name> names
// (compare-page.ts), on a canvas that fills the panel. Each link loads the page
// afresh, so the engine of the last demo stops with its workers and memory; the sidebar keeps its
// scroll position across that load. Without ?demo=, the
// panel shows a short welcome. In a narrow window, the sidebar is a drawer that the menu button
// opens. In a development build the engine also reads its own switches from the address: ?hold=2
// draws the frame at 2 seconds that the demo's image test holds, and ?gpu=webgl2 forces a GPU path.
// A production build reads no switches, so this page reads ?preset= itself and gives it to the
// demo's engine, and keeps it in the sidebar's links. The page's links are
// relative, so it runs under any address prefix. It is one layout of the demos: another page can
// show them its own way with the list and startDemo.

import type { QualityPreset } from '@null3d/engine';
import { COMPARE_GROUP, COMPARISONS } from './compare/comparisons';
import { runComparison } from './compare-page';
import { DEMO_GROUPS, DEMOS, type Demo } from './demos';
import { COARSE_INPUT, type InputKind, watchInputKind } from './lib/input-kind';
import { startDemo } from './lib/run';
import { sourceUrl } from './lib/source';

/** The quality presets that `?preset=` may name, from the lightest. A production build reads no
 * URL switches, so this page reads the preset itself and gives it to each demo's engine. */
const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

const params = new URLSearchParams(location.search);
const name = params.get('demo');
const current = DEMOS.find((demo) => demo.name === name);
const compareName = params.get('compare');
const comparison = COMPARISONS.find((entry) => entry.name === compareName);
const wanted = params.get('preset');
const preset = PRESETS.find((entry) => entry === wanted);

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

/** The address of a demo's page, keeping the preset that the address named. */
const demoLink = (demo: Demo) =>
	preset === undefined ? `?demo=${demo.name}` : `?demo=${demo.name}&preset=${preset}`;

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

/** A demo's title, then its scene as a smaller sub-title under it, on its own line, and a bar that
 * shows the progress of work the scene does after its start, such as regrowing a meadow. */
function heading(demo: Demo, growthBar = false): (string | HTMLElement)[] {
	const name = element('span', demo.title);
	name.className = 'name';
	const scene = element('span', demo.scene);
	scene.className = 'scene';
	const growth = element('span');
	growth.className = 'growth';
	growth.id = 'demo-growth';
	growth.hidden = true;
	growth.style.cssText = ['display:flex', 'align-items:center', 'gap:8px', 'margin-top:6px'].join(
		';',
	);
	const track = element('span');
	track.style.cssText = [
		'flex:1',
		'height:4px',
		'border-radius:2px',
		'background:rgba(255,255,255,0.18)',
		'overflow:hidden',
	].join(';');
	const fill = element('span');
	fill.id = 'demo-growth-fill';
	fill.style.cssText = [
		'display:block',
		'width:0%',
		'height:100%',
		'border-radius:2px',
		'background:#8fbf8e',
		'transition:width 120ms linear',
	].join(';');
	track.append(fill);
	const percent = element('span');
	percent.id = 'demo-growth-percent';
	percent.textContent = '0%';
	percent.style.cssText = 'font-variant-numeric:tabular-nums;font-size:11px;opacity:0.8';
	growth.append(track, percent);
	return growthBar ? [name, scene, growth] : [name, scene];
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
 * The demo's key help: one row for each of its keys or pointer actions, each key as a key cap,
 * then what it does.
 */
function keyHelp(demo: Demo): HTMLElement | undefined {
	if (!demo.controls?.length) return undefined;
	const panel = element('dl');
	panel.className = 'keys';
	panel.setAttribute('aria-label', 'Keys');
	for (const control of demo.controls) {
		const caps = element('dt');
		for (const key of control.keys) caps.append(element('kbd', key));
		panel.append(caps, element('dd', control.does));
	}
	return panel;
}

/**
 * The demo's gestures, for a finger: what a drag and the touch controls do, with no key caps, since
 * a touch screen has no keyboard.
 */
function gestureHelp(demo: Demo): HTMLElement {
	const panel = element('dl');
	panel.className = 'gestures';
	panel.setAttribute('aria-label', 'Gestures');
	const row = (what: string, does: string): void => {
		panel.append(element('dt', what), element('dd', does));
	};
	row('Drag the scene', 'Turn the camera in Manual mode');
	row('Pinch', 'Zoom in or out');
	row('Two fingers', 'Pan the camera in Manual mode');
	row('HUD', 'Open it at the bottom of the screen. The Auto / Manual switch is inside.');
	if (demo.gustKey !== undefined) row('Gust', 'Send a gust across the scene');
	return panel;
}

/** The sheet's about: the demo's title, what it shows, its code and its credits. */
function aboutBody(demo: Demo): HTMLElement {
	const body = element('div');
	body.className = 'about';
	const scene = element('p', demo.scene);
	scene.className = 'about__scene';
	const summary = element('p', demo.summary);
	summary.className = 'about__summary';
	const code = element('a', 'View code', sourceUrl(demo));
	code.target = '_blank';
	code.rel = 'noopener';
	const links = element('p');
	links.className = 'quiet';
	links.append(code);
	const credits = element('p', 'Built by the null3D contributors.');
	credits.className = 'quiet';
	body.append(scene, summary, links, credits);
	return body;
}

/** An SVG chevron, pointing down unless the caller's own class turns it. */
function chevronIcon(size: number): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('aria-hidden', 'true');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', 'M6 9l6 6 6-6');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.append(path);
	return svg;
}

/**
 * The demos page's About sheet: the demo's information over the scene, as a bottom sheet on a
 * finger and a centred dialog on a mouse. It scrolls inside, closes by its button, by Escape or by
 * a press on its backdrop, holds the focus while it is open, and never resizes the scene.
 */
interface Sheet {
	readonly element: HTMLElement;
	open(): void;
	close(): void;
	/** Shows a start's failure in the sheet. */
	showError(message: string): void;
	/** Fills the sheet's Controls tab, or hides the tab when there is nothing to show. */
	setControls(panel: HTMLElement | undefined): void;
	readonly isOpen: boolean;
}

/** Builds the sheet of a demo. */
function createSheet(demo: Demo): Sheet {
	const root = element('div');
	root.className = 'sheet';
	root.hidden = true;
	const backdrop = element('div');
	backdrop.className = 'sheet__backdrop';
	const dialog = element('section');
	dialog.className = 'sheet__dialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-labelledby', 'sheet-title');
	const head = element('header');
	head.className = 'sheet__head';
	const heading = element('h2', demo.title);
	heading.id = 'sheet-title';
	const close = element('button', '×');
	close.type = 'button';
	close.className = 'sheet__close';
	close.setAttribute('aria-label', 'Close');
	head.append(heading, close);
	const body = element('div');
	body.className = 'sheet__body';
	const about = aboutBody(demo);
	const aboutPanel = element('section');
	aboutPanel.className = 'sheet__panel';
	aboutPanel.setAttribute('role', 'tabpanel');
	aboutPanel.append(about);
	const controlsPanel = element('section');
	controlsPanel.className = 'sheet__panel';
	controlsPanel.setAttribute('role', 'tabpanel');
	controlsPanel.hidden = true;
	body.append(aboutPanel, controlsPanel);
	// The tabs sit between the title and the body: the demo's story, and what it does under the hand.
	const tabs = element('div');
	tabs.className = 'sheet__tabs';
	tabs.setAttribute('role', 'tablist');
	const tab = (label: string, panel: HTMLElement): HTMLButtonElement => {
		const button = element('button', label);
		button.type = 'button';
		button.className = 'sheet__tab';
		button.setAttribute('role', 'tab');
		button.addEventListener('click', () => select(panel));
		return button;
	};
	const aboutTab = tab('About', aboutPanel);
	const controlsTab = tab('Controls', controlsPanel);
	tabs.append(aboutTab, controlsTab);
	const select = (panel: HTMLElement): void => {
		const controls = panel === controlsPanel;
		if (controls && controlsTab.hidden) return;
		aboutPanel.hidden = controls;
		controlsPanel.hidden = !controls;
		aboutTab.setAttribute('aria-selected', String(!controls));
		controlsTab.setAttribute('aria-selected', String(controls));
	};
	dialog.append(head, tabs, body);
	root.append(backdrop, dialog);

	let opener: HTMLElement | undefined;
	const focusable = (): HTMLElement[] =>
		[
			...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'),
		].filter((node) => !node.hidden && node.offsetParent !== null);
	const open = (): void => {
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		root.hidden = false;
		close.focus();
	};
	const closeSheet = (): void => {
		if (root.hidden) return;
		root.hidden = true;
		opener?.focus();
		opener = undefined;
	};
	backdrop.addEventListener('click', closeSheet);
	close.addEventListener('click', closeSheet);
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && !root.hidden) closeSheet();
	});
	dialog.addEventListener('keydown', (event) => {
		if (event.key !== 'Tab') return;
		const nodes = focusable();
		if (nodes.length === 0) return;
		const first = nodes[0] as HTMLElement;
		const last = nodes[nodes.length - 1] as HTMLElement;
		const active = document.activeElement;
		if (event.shiftKey && (active === first || active === null)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	});
	select(aboutPanel);
	const sheet: Sheet = {
		element: root,
		open,
		close: closeSheet,
		setControls(panel) {
			const shown = panel !== undefined;
			controlsTab.hidden = !shown;
			controlsPanel.replaceChildren(...(panel ? [panel] : []));
			if (!shown && !controlsPanel.hidden) select(aboutPanel);
		},
		showError(message) {
			const error = element('p', message);
			error.className = 'error';
			about.append(error);
		},
		get isOpen() {
			return !root.hidden;
		},
	};
	return sheet;
}

/**
 * Runs the demo on a canvas that fills the panel, with a compact title chip at its top left that
 * opens the demo's about sheet, and holds its key help below: keys on a mouse, gestures on a finger.
 */
async function runDemo(demo: Demo): Promise<void> {
	document.title = `${demo.title} · ${demo.scene}: null3D demos`;
	const canvas = element('canvas');
	// The labels' layer covers the canvas, and lets the pointer through to it.
	const labels = element('div');
	labels.className = 'labels';
	const corner = element('div');
	corner.className = 'corner';
	const chip = element('button');
	chip.type = 'button';
	chip.className = 'chip';
	chip.setAttribute('aria-haspopup', 'dialog');
	chip.append(...heading(demo, true), chevronIcon(16));
	corner.append(chip);
	const sheet = createSheet(demo);
	// The demo's key help sits under the chip on a mouse, and a gesture legend takes its place on a
	// finger. The scene's own controls are the sliding panel that its sketch posts.
	const help = element('div');
	help.className = 'corner__help';
	corner.append(help);
	// The demo's choices, such as a showcase scene's time of day, and a page part's buttons sit in a bar
	// at the bottom of the panel.
	const choices =
		(demo.choices || demo.pagePart) && !params.has('hold') ? element('div') : undefined;
	if (choices) {
		choices.className = 'choices';
	}
	const hud = !params.has('hold') ? element('div') : undefined;
	if (hud) {
		hud.className = 'hud';
		hud.hidden = true;
	}
	stage.append(canvas, labels, corner);
	if (choices) stage.append(choices);
	stage.append(sheet.element);
	if (hud) stage.append(hud);
	chip.addEventListener('click', () => sheet.open());
	// The pointer's capability picks the input, and a change of it moves the page with it.
	const query = matchMedia(COARSE_INPUT);
	const stopWatching = watchInputKind(query, (kind) => {
		document.body.dataset.input = kind;
		const coarse = kind === 'coarse';
		// A finger reads the gestures in the sheet's Controls tab, where they never sit over the
		// scene; a mouse keeps its keys under the chip, out of the way of the picture.
		const gestures = demo.controls?.length && coarse ? gestureHelp(demo) : undefined;
		const keys = demo.controls?.length && !coarse ? keyHelp(demo) : undefined;
		sheet.setControls(gestures);
		help.replaceChildren(...(keys ? [keys] : []));
		help.hidden = keys === undefined;
	});
	// A sketch reads its switches from its own address, such as Skyway's `mood` and `storm`, so the
	// page's switches go on to it.
	const sketch = new URL(demo.sketch);
	for (const [key, value] of params) if (key !== 'demo') sketch.searchParams.set(key, value);
	try {
		await startDemo({
			canvas,
			demo: { ...demo, sketch },
			labels,
			choices,
			hud,
			preset,
		});
	} catch (error) {
		sheet.showError(error instanceof Error ? error.message : String(error));
		sheet.open();
	}
}

listDemos();
restoreNavScroll();
rememberNavScroll();
handleDrawer();
if (comparison) void runComparison(stage, comparison);
else if (current) void runDemo(current);
else welcome(compareName ?? name ?? undefined);
