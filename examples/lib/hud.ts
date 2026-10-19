// The showcase scenes' controls HUD. A translucent chevron sits at the bottom of the panel; pressing
// it slides a full panel of controls up over glass. The panel is tabbed: one tab per group of the
// model, and only the selected group's buttons show, so the panel stays short on any screen, a phone
// included. The tab bar scrolls across, the selected group scrolls inside a bounded panel, and the
// selected tab is remembered while the panel is open. The sketch posts the model, this shell draws
// it, and a pick goes back to the sketch as a message. The CSS lives with the examples' styles.
//
// A button's tip describes what it does alone, with no input device named. The tip shows on hover,
// keyboard focus and a press, and hides on a leave, a blur, a tap elsewhere, a scroll or after a
// few seconds. It lives outside the scrolling panel, so it is never clipped.
import type { HudModel } from './controls';

export type { HudButton, HudGroup, HudModel } from './controls';

/** How long a tip stays after a press, in milliseconds. */
const TIP_HOLD = 2800;

/** The controls HUD of a showcase scene. */
export interface Hud {
	/** Draws the model, and shows or hides the whole control. */
	render(model: HudModel, visible: boolean): void;
	/** Removes the HUD's nodes and its listeners, so a page may start another demo in the same one. */
	dispose(): void;
}

/** A new element with its class and its text. */
function node<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = text;
	return element;
}

/**
 * Makes the controls HUD in `element`, which the page owns, and posts each pick with `post` as the
 * button's group name and its id. `stage` holds the tip, so the tip is not clipped by the panel.
 */
export function createHud(
	element: HTMLElement,
	stage: HTMLElement,
	post: (name: string, value: string) => void,
): Hud {
	element.replaceChildren();
	element.classList.add('hud');
	const panel = node('div', 'hud__panel');
	panel.id = 'hud-panel';
	panel.setAttribute('role', 'region');
	panel.setAttribute('aria-label', 'Scene controls');
	const tabs = node('div', 'hud__tabs');
	tabs.setAttribute('role', 'tablist');
	tabs.setAttribute('aria-label', 'Scene control groups');
	const body = node('div', 'hud__body');
	panel.append(tabs, body);
	const chevron = node('button', 'hud__chevron');
	chevron.type = 'button';
	chevron.setAttribute('aria-expanded', 'false');
	chevron.setAttribute('aria-controls', 'hud-panel');
	chevron.setAttribute('aria-keyshortcuts', 'H');
	chevron.setAttribute('title', 'Scene controls (H)');
	const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	arrow.setAttribute('viewBox', '0 0 24 24');
	arrow.setAttribute('width', '22');
	arrow.setAttribute('height', '22');
	arrow.setAttribute('fill', 'none');
	arrow.setAttribute('aria-hidden', 'true');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', 'M6 15l6-6 6 6');
	path.setAttribute('stroke', 'currentColor');
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	arrow.append(path);
	const badge = node('kbd', 'hud__key', 'H');
	chevron.append(arrow, badge);
	element.append(panel, chevron);

	// The tip floats over the stage, above the panel and outside its scroll box.
	const tip = node('div', 'hud__tip');
	tip.setAttribute('role', 'tooltip');
	stage.append(tip);

	const setOpen = (open: boolean): void => {
		element.classList.toggle('open', open);
		chevron.setAttribute('aria-expanded', String(open));
		chevron.setAttribute('aria-label', open ? 'Hide scene controls' : 'Show scene controls');
		if (!open) hideTip();
	};
	/** The listeners that outlive `element`, which one signal drops together. */
	const listeners = new AbortController();
	const { signal } = listeners;
	let tipTimer: ReturnType<typeof setTimeout> | 0 = 0;
	function hideTip(): void {
		clearTimeout(tipTimer);
		tip.classList.remove('show');
	}
	function showTip(button: HTMLElement, hold: boolean): void {
		const text = button.dataset.tip;
		if (!text) return;
		clearTimeout(tipTimer);
		tip.textContent = text;
		tip.classList.add('show');
		const stageBox = stage.getBoundingClientRect();
		const buttonBox = button.getBoundingClientRect();
		const width = tip.offsetWidth;
		const height = tip.offsetHeight;
		let left = buttonBox.left - stageBox.left + buttonBox.width / 2 - width / 2;
		left = Math.max(8, Math.min(left, stageBox.width - width - 8));
		let top = buttonBox.top - stageBox.top - height - 8;
		if (top < 8) top = buttonBox.bottom - stageBox.top + 8;
		tip.style.left = `${left}px`;
		tip.style.top = `${top}px`;
		if (hold) tipTimer = setTimeout(hideTip, TIP_HOLD);
	}
	// The tip answers a pointer, keyboard focus and a press alike, so no device is assumed.
	const bindTip = (button: HTMLElement): void => {
		button.addEventListener('pointerenter', () => showTip(button, false));
		button.addEventListener('pointerleave', hideTip);
		button.addEventListener('focus', () => showTip(button, false));
		button.addEventListener('blur', hideTip);
		button.addEventListener('click', () => showTip(button, true));
	};
	bindTip(chevron);
	chevron.addEventListener('click', () => setOpen(!element.classList.contains('open')));
	panel.addEventListener('scroll', hideTip);
	stage.addEventListener(
		'pointerdown',
		(event) => {
			const target = event.target;
			if (!(target instanceof Element) || !target.closest('[data-tip]')) hideTip();
		},
		{ signal },
	);
	document.addEventListener(
		'keydown',
		(event) => {
			// A shortcut never fights a browser or an editor shortcut, and never types into a field.
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable || target.matches('input, textarea, select'))
			)
				return;
			if (event.key === 'h' || event.key === 'H') setOpen(!element.classList.contains('open'));
			else if (event.key === 'Escape') setOpen(false);
		},
		{ signal },
	);

	/** The buttons drawn now, by their group and id, so a render only turns them on and off. */
	let drawn = new Map<string, HTMLButtonElement>();
	/** The sliders drawn now, by their group's name, so a render only moves their values. */
	let sliders = new Map<string, HTMLInputElement>();
	/** The tab and the panel drawn for each group, by the group's name. */
	let tabButtons = new Map<string, HTMLButtonElement>();
	let tabPanels = new Map<string, HTMLElement>();
	/** The selected tab's group name. Camera, the first group, until a tab picks another. */
	let active = 'camera';
	let signature = '';
	/** Shows one group: its tab is selected and only its panel is visible. */
	const selectTab = (name: string, focus = false): void => {
		active = name;
		for (const [group, tab] of tabButtons) {
			const on = group === name;
			tab.setAttribute('aria-selected', String(on));
			tab.tabIndex = on ? 0 : -1;
			tab.classList.toggle('hud__tab--on', on);
		}
		for (const [group, section] of tabPanels) section.hidden = group !== name;
		if (focus) tabButtons.get(name)?.focus();
	};
	/** Moves the selection along the tab bar with the arrow keys, as a tablist does. */
	const moveTab = (names: readonly string[], from: string, key: string): void => {
		const index = names.indexOf(from);
		let to = -1;
		if (key === 'ArrowRight') to = (index + 1) % names.length;
		else if (key === 'ArrowLeft') to = (index - 1 + names.length) % names.length;
		else if (key === 'Home') to = 0;
		else if (key === 'End') to = names.length - 1;
		const name = names[to];
		if (to >= 0 && name !== undefined) selectTab(name, true);
	};
	const draw = (model: HudModel): void => {
		const next = model.groups
			.map(
				(group) =>
					`${group.name}|${group.title}|${group.radio}|${group.slider ? `${group.slider.min}~${group.slider.max}~${group.slider.step}~${group.slider.tip}~${group.slider.marks.map((m) => `${m.at}~${m.label}`).join(',')}` : ''}|${group.buttons.map((b) => `${b.id}~${b.label}~${b.key ?? ''}~${b.tip}`).join(';')}|${(group.extras ?? []).map((b) => `${b.id}~${b.label}~${b.tip}`).join(';')}`,
			)
			.join('||');
		if (next !== signature) {
			signature = next;
			drawn = new Map();
			sliders = new Map();
			tabButtons = new Map();
			tabPanels = new Map();
			const names = model.groups.map((group) => group.name);
			tabs.replaceChildren(
				...model.groups.map((group) => {
					const tab = node('button', 'hud__tab');
					tab.type = 'button';
					tab.id = `hud-tab-${group.name}`;
					tab.setAttribute('role', 'tab');
					tab.setAttribute('aria-controls', `hud-panel-${group.name}`);
					tab.textContent = group.title;
					tab.addEventListener('click', () => selectTab(group.name));
					tab.addEventListener('keydown', (event) => {
						if (!event.key.startsWith('Arrow') && event.key !== 'Home' && event.key !== 'End')
							return;
						event.preventDefault();
						moveTab(names, group.name, event.key);
					});
					tabButtons.set(group.name, tab);
					return tab;
				}),
			);
			body.replaceChildren(
				...model.groups.map((group) => {
					const section = node('section', 'hud__group');
					section.id = `hud-panel-${group.name}`;
					section.setAttribute('role', 'tabpanel');
					section.setAttribute('aria-labelledby', `hud-tab-${group.name}`);
					const { slider } = group;
					if (slider) {
						// The track sets one continuous value, and its labels name the key points along it.
						const wrap = node('div', 'hud__slider');
						const range = document.createElement('input');
						range.type = 'range';
						range.className = 'hud__range';
						range.min = String(slider.min);
						range.max = String(slider.max);
						range.step = String(slider.step);
						range.value = String(slider.value);
						range.dataset.tip = slider.tip;
						range.setAttribute('aria-label', group.title);
						range.addEventListener('input', () => post(group.name, range.value));
						bindTip(range);
						const marks = node('div', 'hud__marks');
						for (const mark of slider.marks) {
							const label = node('span', 'hud__mark', mark.label);
							const share = (mark.at - slider.min) / (slider.max - slider.min);
							// A label near an end is anchored to that end, so it never runs past the track.
							label.style.left = `${share * 100}%`;
							if (share < 0.06) label.style.transform = 'translateX(0)';
							else if (share > 0.94) label.style.transform = 'translateX(-100%)';
							marks.append(label);
						}
						wrap.append(range, marks);
						section.append(wrap);
						sliders.set(group.name, range);
					}
					const buttons = node('div', 'hud__buttons');
					for (const button of group.buttons) {
						const el = node('button', `hud__btn${group.radio ? '' : ' hud__btn--toggle'}`);
						el.type = 'button';
						el.dataset.tip = button.tip;
						el.append(
							document.createTextNode(button.label),
							...(button.key ? [node('kbd', undefined, button.key)] : []),
						);
						el.addEventListener('click', () => post(button.name ?? group.name, button.id));
						bindTip(el);
						buttons.append(el);
						drawn.set(`${group.name}\u0000${button.id}`, el);
					}
					if (group.extras?.length) {
						// A group may also carry switches, such as the level of detail under Quality. They
						// follow the row's choice after a separator, so the row stays one line.
						buttons.append(node('span', 'hud__sep'));
						for (const button of group.extras) {
							const el = node('button', 'hud__btn hud__btn--toggle');
							el.type = 'button';
							el.dataset.tip = button.tip;
							el.append(document.createTextNode(button.label));
							el.addEventListener('click', () => post(button.name ?? group.name, button.id));
							bindTip(el);
							buttons.append(el);
							drawn.set(`${group.name}\u0000extra:${button.id}`, el);
						}
					}
					section.append(buttons);
					tabPanels.set(group.name, section);
					return section;
				}),
			);
			if (!tabButtons.has(active)) active = model.groups[0]?.name ?? '';
			selectTab(active);
		}
		for (const group of model.groups) {
			const range = sliders.get(group.name);
			if (range && group.slider) {
				// A value that moves by itself, as the hour does in Auto, moves the thumb with it, unless
				// the user is holding it.
				if (document.activeElement !== range) range.value = String(group.slider.value);
				range.setAttribute('aria-valuetext', group.slider.live ? 'Auto' : range.value);
				range.classList.toggle('hud__range--live', group.slider.live);
			}
			for (const button of [...group.buttons, ...(group.extras ?? [])]) {
				const extra = group.extras?.includes(button) ?? false;
				const el = drawn.get(`${group.name}\u0000${extra ? 'extra:' : ''}${button.id}`);
				if (!el) continue;
				el.setAttribute('aria-pressed', String(button.active));
				el.classList.toggle('hud__btn--on', button.active);
			}
		}
	};
	// The toast that names each change, at the top of the view. A new one replaces the old, and it
	// never takes a click.
	const toast = node('div', 'hud__toast');
	stage.append(toast);
	let toastTimer: ReturnType<typeof setTimeout> | 0 = 0;
	const showToast = (text: string): void => {
		clearTimeout(toastTimer);
		toast.textContent = text;
		toast.classList.add('show');
		toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
	};
	/** Each button's state at the last render, so a change can name itself. It is undefined before
	 * the first render, so the first state that arrives does not toast. */
	let shown: Map<string, boolean> | undefined;
	/** Names a change in the controls, as a toast: a mode's new value, or a toggle's on and off. */
	const toastChanges = (model: HudModel): void => {
		const next = new Map<string, boolean>();
		for (const group of model.groups)
			for (const button of [...group.buttons, ...(group.extras ?? [])]) {
				const key = `${group.name}\u0000${button.id}`;
				next.set(key, button.active);
				const before = shown?.get(key);
				if (shown === undefined || before === undefined || before === button.active) continue;
				if (button.active)
					showToast(
						group.radio ? `${group.title}: ${button.label}`.toLowerCase() : `${button.label}: on`,
					);
				else if (!group.radio) showToast(`${button.label}: off`);
			}
		shown = next;
	};
	return {
		render(model, visible) {
			element.hidden = !visible;
			draw(model);
			toastChanges(model);
		},
		dispose() {
			listeners.abort();
			clearTimeout(tipTimer);
			clearTimeout(toastTimer);
			tip.remove();
			toast.remove();
			element.replaceChildren();
		},
	};
}
