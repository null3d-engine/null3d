// The examples page. Without ?demo= it lists the demos. With ?demo=<name> it runs that demo's sketch
// on a canvas that fills the window. The engine reads its own switches from the address: ?hold=2
// draws the frame at 2 seconds that the demo's image test holds, and ?gpu=webgl2 forces a GPU tier.
// A demo's sketch can post 'label' messages: the page then shows each label's text in an element
// that follows the label's object.
import { createEngine, type Engine } from '@null3d/engine';
import { DEMOS, type Demo } from './demos';

const params = new URLSearchParams(location.search);
const main = document.querySelector('main') as HTMLElement;

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

function listDemos(): void {
	const list = element('ul');
	for (const demo of DEMOS) {
		const item = element('li');
		const title = element('p');
		title.append(
			element('a', demo.title, demoLink(demo)),
			' (',
			element('a', `held at ${demo.hold} s`, demoLink(demo, true)),
			')',
		);
		item.append(title, element('p', demo.summary));
		list.append(item);
	}
	main.append(
		element('h1', 'null3D demos'),
		element(
			'p',
			'Each demo is one sketch. Add ?gpu=webgl2 or ?gpu=compat to an address to force a GPU tier.',
		),
		list,
	);
}

/** The message that a demo posts to show a label, or to change its text. */
interface LabelMessage {
	/** The id that the sketch tracks the label under with ui.trackLabel. */
	id: string;
	text: string;
	/** True to highlight the label, such as for a selected object. */
	active?: boolean;
}

/** Shows the labels that the demo posts, each in an element that follows the label's object. */
function showLabels(engine: Engine, layer: HTMLElement): void {
	const tags = new Map<string, HTMLElement>();
	engine.onSketchMessage((type, data) => {
		if (type !== 'label') return;
		const { id, text, active = false } = data as LabelMessage;
		let tag = tags.get(id);
		if (!tag) {
			tag = element('div');
			tag.className = 'label';
			layer.append(tag);
			tags.set(id, tag);
			engine.labels.bind(id, tag);
		}
		tag.textContent = text;
		tag.classList.toggle('active', active);
	});
}

async function runDemo(demo: Demo): Promise<void> {
	document.title = `${demo.title}: null3D demos`;
	const canvas = element('canvas');
	// The demos zoom with the wheel and a trackpad pinch, which would otherwise scroll or zoom the page.
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
	const panel = element('div');
	panel.className = 'panel';
	const links = element('p');
	links.append(
		element('a', 'All demos', './'),
		' · ',
		params.has('hold')
			? element('a', 'Live', demoLink(demo))
			: element('a', 'Held frame', demoLink(demo, true)),
	);
	panel.append(element('h1', demo.title), element('p', demo.summary));
	if (demo.controls) panel.append(element('p', demo.controls));
	panel.append(links);
	// The labels' layer covers the canvas, and lets the pointer through to it.
	const labels = element('div');
	labels.className = 'labels';
	main.replaceWith(canvas, labels, panel);
	try {
		const engine = await createEngine({
			canvas,
			sketch: new URL(`/examples/${demo.name}/sketch.ts`, location.origin),
			largeWorld: demo.largeWorld,
		});
		showLabels(engine, labels);
	} catch (error) {
		const message = element('p', error instanceof Error ? error.message : String(error));
		message.className = 'error';
		panel.append(message);
	}
}

const name = params.get('demo');
if (name === null) listDemos();
else {
	const demo = DEMOS.find((candidate) => candidate.name === name);
	if (demo) void runDemo(demo);
	else {
		main.append(element('p', `There is no demo named ${name}.`), element('a', 'All demos', './'));
	}
}
