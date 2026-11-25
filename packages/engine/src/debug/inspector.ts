// The in-page inspector: a panel docked at the left edge of the page, in a development build. It
// lists the scene as a tree, selects an object and outlines it in the view, edits its transform, its
// material and its visibility, and shows the engine's frame figures. It reads and writes the live
// scene through the page's inspection bridge (`engine.inspect`), so each change is applied between
// frames. The page loads this module on first use, when the `?inspect` switch asks for it.

/** The calls that the panel makes, as the engine's inspection channel takes them. */
export interface InspectorBridge {
	inspect(call: string, args?: unknown): Promise<unknown>;
	/** The canvas that the engine draws on. */
	canvas: HTMLCanvasElement;
}

/** One object in a listing. */
interface Summary {
	slot: number;
	handle: number;
	name: string;
	kind: string;
	dynamic: boolean;
	visible: boolean;
	layers: number;
	parent: number | null;
	children: number;
	material?: number;
}

/** One object with its transform and its material. */
interface Detail extends Summary {
	position: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
	worldPosition: [number, number, number];
	materialValues?: Record<string, unknown>;
	shading?: number;
}

/** A listing's answer. */
interface Listing {
	objects: Summary[];
	count: number;
	truncated: boolean;
}

/** The frame figures that the panel shows. */
interface Stats {
	frames: number;
	presentedFps: number;
	completedFps: number;
	cpuMs: number;
	gpuMs: number | null;
	drawCalls: number;
	triangles: number;
	objects: number;
	uploadBytes: number;
	tier: string;
	preset: string;
	renderScale: number;
	wasmBytes: number;
}

/** The most rows that the tree draws at once, so a scene of many thousands stays responsive. */
const MAX_ROWS = 2000;
/** How long the search waits for the next key before it lists the scene again. */
const SEARCH_DELAY_MS = 150;
/** How often the panel reads the frame figures. */
const STATS_MS = 1000;

const CSS = `
:host { all: initial; }
.panel {
	--ok: #3ddc97; --amber: #f2b453; --line: rgba(255, 255, 255, 0.08);
	--line-soft: rgba(255, 255, 255, 0.045);
	--text: #e9eef7; --dim: #98a3b6; --faint: #7a8699;
	position: fixed; left: 0; top: 0; bottom: 0; z-index: 2147483646;
	width: 320px; max-width: 82vw;
	display: flex; flex-direction: column;
	background: linear-gradient(180deg, rgba(20, 25, 33, 0.97), rgba(13, 17, 23, 0.98));
	border-right: 1px solid rgba(255, 255, 255, 0.1);
	box-shadow: 12px 0 30px rgba(0, 0, 0, 0.4);
	color: var(--text);
	font: 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	font-variant-numeric: tabular-nums;
	overflow: hidden;
}
.head { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid var(--line); }
.head .title { font-weight: 600; font-size: 14px; letter-spacing: 0.01em; }
.head .meta { margin-left: auto; color: var(--faint); font-size: 10px; }
.head button {
	border: 0; background: none; color: var(--faint); font: inherit; font-size: 16px;
	cursor: pointer; padding: 0 2px; line-height: 1;
}
.head button:hover { color: var(--text); }
.find { padding: 10px 12px 6px; }
.find input, .field input {
	box-sizing: border-box; width: 100%;
	border: 1px solid var(--line); border-radius: 6px; background: #11161f;
	color: var(--text); font: inherit; padding: 4px 7px; outline: none;
}
.find input:focus, .field input:focus { border-color: rgba(242, 180, 83, 0.55); }
.tree { flex: 1 1 26%; min-height: 70px; overflow: auto; padding: 2px 8px 8px; }
.row { display: flex; align-items: center; gap: 5px; padding: 2px 5px; border-radius: 5px; cursor: pointer; color: var(--dim); }
.row:hover { background: rgba(255, 255, 255, 0.04); }
.row.sel { background: rgba(242, 180, 83, 0.14); color: var(--text); }
.row .tw { width: 10px; flex: none; text-align: center; color: var(--faint); }
.row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .kind { margin-left: auto; font-size: 9px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--faint); flex: none; }
.truncated { color: var(--faint); padding: 6px 8px; font-size: 10.5px; }
.detail { border-top: 1px solid var(--line); padding: 9px 12px 10px; overflow: auto; flex: 1 1 auto; min-height: 0; }
.detail .empty { color: var(--faint); }
.detail .title { font-weight: 600; font-size: 12.5px; }
.detail .meta { color: var(--faint); font-size: 9.5px; margin-left: 6px; }
.group { margin-top: 8px; }
.group .label { font-size: 8.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); margin-bottom: 3px; }
.triple { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.triple input { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; padding: 3px 5px; }
.check { display: flex; align-items: center; gap: 6px; color: var(--dim); }
.check input { width: 14px; height: 14px; accent-color: #3ddc97; }
.material { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.mat-row { display: flex; align-items: center; gap: 7px; color: var(--dim); }
.mat-row .name { width: 74px; flex: none; }
.mat-row input[type="color"] { width: 26px; height: 20px; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: #11161f; }
.mat-row input[type="range"] { flex: 1; min-width: 0; accent-color: #a98bfa; }
.mat-row input[type="number"] { width: 48px; text-align: right; font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; padding: 2px 4px; }
.figures { border-top: 1px solid var(--line); padding: 8px 12px 11px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.fig { background: rgba(255, 255, 255, 0.035); border: 1px solid var(--line-soft); border-radius: 6px; padding: 4px 6px; min-width: 0; }
.fig .k { font-size: 8px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); }
.fig .v { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fig .v small { font-size: 8px; font-weight: 500; color: var(--dim); }
.error { color: #ff8074; padding: 0 12px 8px; font-size: 10.5px; }
.hint { color: var(--faint); font-size: 10px; padding: 0 12px 8px; }
`;

/** The panel's element, which a page finds by this attribute. */
export const INSPECTOR_ATTRIBUTE = 'data-null3d-inspector';

/** Makes an element with a class and, where given, text. */
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className !== undefined) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** Throws the bridge's error as an Error with its text, whatever it was. */
function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** Puts the panel's style sheet in its shadow root, passing a Content Security Policy without 'unsafe-inline'. */
function installStyles(root: ShadowRoot): void {
	try {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(CSS);
		root.adoptedStyleSheets = [sheet];
	} catch {
		const style = document.createElement('style');
		style.textContent = CSS;
		root.append(style);
	}
}

/** Turns a quaternion (x, y, z, w) into X, then Y, then Z Euler angles in radians, as the engine's setRotationEuler takes. */
function quaternionToEuler(q: readonly number[]): [number, number, number] {
	const x = q[0] as number;
	const y = q[1] as number;
	const z = q[2] as number;
	const w = q[3] as number;
	const ex = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
	const sy = 2 * (w * y - z * x);
	const ey = Math.asin(Math.min(1, Math.max(-1, sy)));
	const ez = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
	return [ex, ey, ez];
}

/** The panel of the in-page inspector. */
export class Inspector {
	private readonly host: HTMLDivElement;
	private readonly tree = el('div', 'tree');
	private readonly detail = el('div', 'detail');
	private readonly figures = el('div', 'figures');
	private readonly count = el('span', 'meta', '');
	private readonly search = el('input');
	private readonly error = el('div', 'error');
	private readonly treeRows: HTMLElement[] = [];
	private readonly collapsed = new Set<number>();
	private selected: number | undefined;
	private summaries = new Map<number, Summary>();
	private statsTimer: ReturnType<typeof setInterval> | undefined;
	private searchTimer: ReturnType<typeof setTimeout> | undefined;
	private selectToken = 0;
	private listToken = 0;
	private statsBusy = false;
	private removed = false;

	constructor(private readonly bridge: InspectorBridge) {
		this.host = document.createElement('div');
		this.host.setAttribute(INSPECTOR_ATTRIBUTE, '');
		const root = this.host.attachShadow({ mode: 'open' });
		installStyles(root);
		const panel = el('div', 'panel');
		const head = el('div', 'head');
		head.append(el('span', 'title', 'Scene'), this.count);
		const close = el('button', '', '×');
		close.type = 'button';
		close.setAttribute('aria-label', 'Close the inspector');
		close.addEventListener('click', () => this.remove());
		const refresh = el('button', '', '↻');
		refresh.type = 'button';
		refresh.title = 'List the scene again';
		refresh.setAttribute('aria-label', 'List the scene again');
		refresh.addEventListener('click', () => void this.list());
		head.append(refresh, close);
		this.search.type = 'search';
		this.search.placeholder = 'Find an object';
		this.search.setAttribute('aria-label', 'Find an object by name');
		this.search.addEventListener('input', () => this.scheduleSearch());
		const find = el('div', 'find');
		find.append(this.search);
		this.detail.append(el('div', 'empty', 'Select an object to edit it.'));
		const hint = el('div', 'hint', '?inspect · development build');
		panel.append(head, find, this.tree, this.detail, this.figures, this.error, hint);
		root.append(panel);
		panel.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') this.remove();
		});
		document.body.append(this.host);
		void this.list();
		this.refreshStats();
		this.statsTimer = setInterval(() => this.refreshStats(), STATS_MS);
	}

	/** Takes the panel off the page and clears the selection's outline. */
	remove(): void {
		if (this.removed) return;
		this.removed = true;
		if (this.statsTimer !== undefined) clearInterval(this.statsTimer);
		if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
		this.host.remove();
		void this.bridge.inspect('highlight', {}).catch(() => {});
	}

	/** Lists the scene again after the search settles. */
	private scheduleSearch(): void {
		if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
		this.searchTimer = setTimeout(() => {
			this.searchTimer = undefined;
			void this.list();
		}, SEARCH_DELAY_MS);
	}

	/** Lists the scene, or the objects that the search names, and draws the tree. */
	private async list(): Promise<void> {
		const token = ++this.listToken;
		try {
			const answer = (await this.bridge.inspect('objects', {
				filter: this.search.value.trim() || undefined,
			})) as Listing;
			if (token !== this.listToken || this.removed) return;
			this.showError(undefined);
			this.summaries = new Map(answer.objects.map((object) => [object.slot, object]));
			this.count.textContent = `${answer.count} object${answer.count === 1 ? '' : 's'}`;
			this.drawTree(answer);
		} catch (error) {
			if (token === this.listToken) this.showError(asError(error).message);
		}
	}

	/** Draws the tree from a listing, parents before their children, with the rows nested. */
	private drawTree(listing: Listing): void {
		this.tree.replaceChildren();
		this.treeRows.length = 0;
		const children = new Map<number | null, Summary[]>();
		for (const object of listing.objects) {
			const parent =
				object.parent !== null && this.summaries.has(object.parent) ? object.parent : null;
			const list = children.get(parent);
			if (list === undefined) children.set(parent, [object]);
			else list.push(object);
		}
		let rows = 0;
		const append = (parent: number | null, depth: number): void => {
			const list = children.get(parent);
			if (list === undefined) return;
			for (const object of list) {
				if (rows >= MAX_ROWS) return;
				const row = el('div', 'row');
				row.style.paddingLeft = `${5 + depth * 12}px`;
				row.dataset.slot = String(object.slot);
				const hasChildren = object.children > 0 && children.has(object.slot);
				const twist = el(
					'span',
					'tw',
					hasChildren ? (this.collapsed.has(object.slot) ? '▸' : '▾') : '·',
				);
				twist.addEventListener('click', (event) => {
					event.stopPropagation();
					if (this.collapsed.has(object.slot)) this.collapsed.delete(object.slot);
					else this.collapsed.add(object.slot);
					this.drawTree(listing);
				});
				row.append(
					twist,
					el('span', 'name', object.name || '(unnamed)'),
					el('span', 'kind', object.kind),
				);
				row.addEventListener('click', () => void this.select(object.slot));
				if (object.slot === this.selected) row.classList.add('sel');
				row.setAttribute('role', 'treeitem');
				this.tree.append(row);
				this.treeRows.push(row);
				rows++;
				if (hasChildren && !this.collapsed.has(object.slot)) append(object.slot, depth + 1);
			}
		};
		append(null, 0);
		if (listing.truncated || listing.count > rows)
			this.tree.append(
				el(
					'div',
					'truncated',
					`Showing the first ${rows} of ${listing.count}. Search to narrow the list.`,
				),
			);
	}

	/** Selects `slot`, outlines it and shows its fields. */
	private async select(slot: number): Promise<void> {
		const token = ++this.selectToken;
		this.selected = slot;
		for (const row of this.treeRows) {
			row.classList.toggle('sel', row.dataset.slot === String(slot));
		}
		try {
			const detail = (await this.bridge.inspect('object', { selector: slot })) as Detail;
			if (token !== this.selectToken || this.removed) return;
			this.showError(undefined);
			this.drawDetail(detail);
			await this.bridge.inspect('highlight', { selector: slot });
		} catch (error) {
			if (token === this.selectToken) this.showError(asError(error).message);
		}
	}

	/** Shows an object's title, transform, flags and material. */
	private drawDetail(detail: Detail): void {
		const title = el('div');
		title.append(
			el('span', 'title', detail.name || '(unnamed)'),
			el('span', 'meta', `#${detail.slot} · ${detail.kind}`),
		);
		const position = this.vectorGroup('Position · m', detail.position, 0.1, (values) =>
			this.change({ selector: detail.slot, position: values }),
		);
		const euler = quaternionToEuler(detail.rotation).map((radians) =>
			Number(((radians * 180) / Math.PI).toFixed(2)),
		);
		const rotation = this.vectorGroup('Rotation · °', euler, 1, (values) =>
			this.change({
				selector: detail.slot,
				rotationEuler: values.map((degrees) => (degrees * Math.PI) / 180),
			}),
		);
		const scale = this.vectorGroup('Scale', detail.scale, 0.01, (values) =>
			this.change({ selector: detail.slot, scale: values }),
		);
		const visible = this.checkField('Visible', detail.visible, (on) =>
			this.change({ selector: detail.slot, visible: on }),
		);
		const dynamic = this.checkField('Dynamic', detail.dynamic, (on) =>
			this.change({ selector: detail.slot, dynamic: on }),
		);
		this.detail.replaceChildren(title, position, rotation, scale, visible, dynamic);
		if (detail.kind === 'mesh' && detail.materialValues !== undefined)
			this.detail.append(this.materialSection(detail));
	}

	/** A labelled row of three number fields that reports all three when one changes. */
	private vectorGroup(
		label: string,
		values: readonly number[],
		step: number,
		change: (values: number[]) => void,
	): HTMLElement {
		const group = el('div', 'group');
		group.append(el('div', 'label', label));
		const triple = el('div', 'triple');
		const inputs: HTMLInputElement[] = [];
		for (let k = 0; k < 3; k++) {
			const input = el('input');
			input.type = 'number';
			input.step = String(step);
			input.value = String(Number((values[k] as number).toFixed(3)));
			input.setAttribute('aria-label', `${label.split(' · ')[0]} ${['X', 'Y', 'Z'][k]}`);
			input.addEventListener('change', () => {
				const numbers = inputs.map((field) => Number(field.value));
				if (numbers.every(Number.isFinite)) change(numbers);
			});
			inputs.push(input);
			triple.append(input);
		}
		group.append(triple);
		return group;
	}

	/** A labelled checkbox. */
	private checkField(label: string, checked: boolean, change: (on: boolean) => void): HTMLElement {
		const group = el('div', 'group');
		const row = el('label', 'check');
		const input = el('input');
		input.type = 'checkbox';
		input.checked = checked;
		input.addEventListener('change', () => change(input.checked));
		row.append(input, document.createTextNode(label));
		group.append(row);
		return group;
	}

	/** The base color and the three values that the inspector edits most. */
	private materialSection(detail: Detail): HTMLElement {
		const values = detail.materialValues ?? {};
		const section = el('div', 'material');
		const color = el('input');
		color.type = 'color';
		color.value = typeof values.color === 'string' ? values.color : '#ffffff';
		color.addEventListener('change', () =>
			this.changeMaterial(detail.slot, { color: color.value }),
		);
		section.append(this.materialRow('Base color', color));
		for (const [key, name] of [
			['roughness', 'Roughness'],
			['metalness', 'Metalness'],
			['opacity', 'Opacity'],
		] as const) {
			const value = typeof values[key] === 'number' ? (values[key] as number) : 1;
			const range = el('input');
			range.type = 'range';
			range.min = '0';
			range.max = '1';
			range.step = '0.01';
			range.value = String(value);
			const number = el('input');
			number.type = 'number';
			number.min = '0';
			number.max = '1';
			number.step = '0.01';
			number.value = String(value);
			const apply = (next: number) => {
				range.value = String(next);
				number.value = String(next);
				this.changeMaterial(detail.slot, { [key]: next });
			};
			range.addEventListener('change', () => apply(Number(range.value)));
			number.addEventListener('change', () => {
				const next = Number(number.value);
				if (Number.isFinite(next)) apply(next);
			});
			const row = el('div', 'mat-row');
			row.append(el('span', 'name', name), range, number);
			section.append(row);
		}
		return section;
	}

	/** One row of the material section. */
	private materialRow(name: string, control: HTMLElement): HTMLElement {
		const row = el('div', 'mat-row');
		row.append(el('span', 'name', name), control);
		return row;
	}

	/** Applies a change to the selected object and shows what the scene now holds. */
	private async change(args: Record<string, unknown>): Promise<void> {
		const token = this.selectToken;
		try {
			const detail = (await this.bridge.inspect('setObject', args)) as Detail;
			if (token !== this.selectToken || this.removed) return;
			this.showError(undefined);
			this.drawDetail(detail);
		} catch (error) {
			this.showError(asError(error).message);
		}
	}

	/** Applies a material change and shows the object's new state. */
	private async changeMaterial(slot: number, values: Record<string, unknown>): Promise<void> {
		const token = this.selectToken;
		try {
			const detail = (await this.bridge.inspect('setMaterial', {
				selector: slot,
				values,
			})) as Detail;
			if (token !== this.selectToken || this.removed) return;
			this.showError(undefined);
			this.drawDetail(detail);
		} catch (error) {
			this.showError(asError(error).message);
		}
	}

	/** Reads the frame figures and shows them. */
	private async refreshStats(): Promise<void> {
		if (this.removed || this.statsBusy) return;
		this.statsBusy = true;
		try {
			const stats = (await this.bridge.inspect('stats')) as Stats;
			if (this.removed) return;
			const figures: [string, string][] = [
				['FPS', stats.frames > 0 ? stats.presentedFps.toFixed(0) : '—'],
				['CPU', stats.frames > 0 ? `${stats.cpuMs.toFixed(1)} ms` : '—'],
				['GPU', stats.gpuMs === null || stats.frames === 0 ? '—' : `${stats.gpuMs.toFixed(1)} ms`],
				['Draws', String(stats.drawCalls)],
				['Triangles', count(stats.triangles)],
				['Objects', String(stats.objects)],
				['Uploads', bytes(stats.uploadBytes)],
				['Preset', stats.preset],
				['Tier', stats.tier],
			];
			const grid = this.figures;
			grid.replaceChildren(
				...figures.map(([key, value]) => {
					const fig = el('div', 'fig');
					fig.append(el('div', 'k', key), el('div', 'v', value));
					return fig;
				}),
			);
		} catch {
			// The figures are a convenience; a stopped engine leaves the last ones drawn.
		} finally {
			this.statsBusy = false;
		}
	}

	/** Shows an error under the detail, or clears it. */
	private showError(message: string | undefined): void {
		this.error.textContent = message ?? '';
	}
}

/** Counts a large number with one decimal and its scale, such as "1.2 M". */
function count(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)} k`;
	return String(Math.round(value));
}

/** Reads bytes as a short figure, such as "412 kB". */
function bytes(value: number): string {
	if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	if (value >= 1024) return `${Math.round(value / 1024)} kB`;
	return `${Math.round(value)} B`;
}

/** Opens the inspector panel on the page, and returns it. */
export function openInspector(bridge: InspectorBridge): Inspector {
	return new Inspector(bridge);
}
