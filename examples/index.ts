// The examples page of a clone. A sidebar lists the demos by group, and the panel beside it runs
// the demo that ?demo=<name> names, on a canvas that fills the panel. Each link loads the page
// afresh, so the engine of the last demo stops with its workers and memory. Without ?demo=, the
// panel shows a short welcome. In a narrow window, the sidebar is a drawer that the menu button
// opens. The engine reads its own switches from the address: ?hold=2 draws the frame at 2 seconds
// that the demo's image test holds, and ?gpu=webgl2 forces a GPU path. The page's links are
// relative, so it runs under any address prefix. It is one layout of the demos: another page can
// show them its own way with the list and startDemo.
import { DEMO_GROUPS, DEMOS, type Demo } from './demos';
import { startDemo } from './lib/run';
import { sourceUrl } from './lib/source';

const params = new URLSearchParams(location.search);
const name = params.get('demo');
const current = DEMOS.find((demo) => demo.name === name);

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

/** The address of a demo's page, live or held at its hold time. */
const demoLink = (demo: Demo, held = false) =>
	`?demo=${demo.name}${held ? `&hold=${demo.hold}` : ''}`;

/** A demo's title, then its scene in a quieter style: "Instancing · 100,000 columns". */
function heading(demo: Demo): (string | HTMLElement)[] {
	const scene = element('span', ` · ${demo.scene}`);
	scene.className = 'scene';
	return [demo.title, scene];
}

/** Lists the demos in the sidebar, group by group, and marks the one that runs. */
function listDemos(): void {
	for (const group of DEMO_GROUPS) {
		const list = element('ul');
		for (const demo of DEMOS) {
			if (demo.group !== group) continue;
			const link = element('a', '', demoLink(demo));
			link.append(...heading(demo));
			// A demo that loads files says so, and why, as the website's list does.
			if (demo.assets) {
				const tag = element('span', 'loads files');
				tag.className = 'tag';
				tag.title = demo.assets;
				link.append(' ', tag);
			}
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
 * Runs the demo on a canvas that fills the panel, with a caption at its top left. The caption's
 * links open the held frame, or the live demo from it, and the demo's code on the main branch.
 */
async function runDemo(demo: Demo): Promise<void> {
	document.title = `${demo.title} · ${demo.scene}: null3D demos`;
	const canvas = element('canvas');
	// The labels' layer covers the canvas, and lets the pointer through to it.
	const labels = element('div');
	labels.className = 'labels';
	const caption = element('details');
	caption.className = 'caption';
	// A narrow window starts with the caption folded to its title, to leave the canvas clear.
	caption.open = wide.matches;
	const title = element('summary');
	const h1 = element('h1');
	h1.append(...heading(demo));
	title.append(h1);
	caption.append(title, element('p', demo.summary));
	if (demo.controls) {
		const controls = element('p', demo.controls);
		controls.className = 'controls';
		caption.append(controls);
	}
	const code = element('a', 'View code', sourceUrl(demo));
	code.target = '_blank';
	code.rel = 'noopener';
	const links = element('p');
	links.className = 'quiet';
	links.append(
		params.has('hold')
			? element('a', 'Live', demoLink(demo))
			: element('a', `Held frame at ${demo.hold} s`, demoLink(demo, true)),
		' · ',
		code,
	);
	caption.append(links);
	stage.append(canvas, labels, caption);
	// A showcase scene's choices, such as its time of day, sit in a bar at the bottom of the panel.
	const choices = demo.choices && !params.has('hold') ? element('div') : undefined;
	if (choices) {
		choices.className = 'choices';
		stage.append(choices);
	}
	try {
		await startDemo({ canvas, demo, labels, choices });
	} catch (error) {
		const message = element('p', error instanceof Error ? error.message : String(error));
		message.className = 'error';
		caption.append(message);
		caption.open = true;
	}
}

listDemos();
handleDrawer();
if (current) void runDemo(current);
else welcome(name ?? undefined);
