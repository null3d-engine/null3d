// The showcase scenes' controls HUD. A translucent chevron sits at the bottom of the panel; pressing
// it slides a full panel of grouped buttons up over glass. The sketch posts the model, this shell
// draws it, and a pick goes back to the sketch as a message. The CSS lives with the examples' styles.
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
	panel.setAttribute('role', 'region');
	panel.setAttribute('aria-label', 'Scene controls');
	const body = node('div', 'hud__body');
	panel.append(body);
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
	stage.addEventListener('pointerdown', (event) => {
		const target = event.target;
		if (!(target instanceof Element) || !target.closest('[data-tip]')) hideTip();
	});
	document.addEventListener('keydown', (event) => {
		if (event.target instanceof HTMLInputElement) return;
		if (event.key === 'h' || event.key === 'H') setOpen(!element.classList.contains('open'));
		else if (event.key === 'Escape') setOpen(false);
	});

	/** The buttons drawn now, by their group and id, so a render only turns them on and off. */
	let drawn = new Map<string, HTMLButtonElement>();
	let signature = '';
	const draw = (model: HudModel): void => {
		const next = model.groups
			.map(
				(group) =>
					`${group.name}|${group.title}|${group.radio}|${group.buttons.map((b) => `${b.id}~${b.label}~${b.key ?? ''}~${b.tip}`).join(';')}`,
			)
			.join('||');
		if (next !== signature) {
			signature = next;
			drawn = new Map();
			body.replaceChildren(
				...model.groups.map((group) => {
					const section = node('section', 'hud__group');
					section.append(node('h3', undefined, group.title));
					const buttons = node('div', 'hud__buttons');
					for (const button of group.buttons) {
						const el = node('button', `hud__btn${group.radio ? '' : ' hud__btn--toggle'}`);
						el.type = 'button';
						el.dataset.tip = button.tip;
						el.append(
							document.createTextNode(button.label),
							...(button.key ? [node('kbd', undefined, button.key)] : []),
						);
						el.addEventListener('click', () => post(group.name, button.id));
						bindTip(el);
						buttons.append(el);
						drawn.set(`${group.name}\u0000${button.id}`, el);
					}
					section.append(buttons);
					return section;
				}),
			);
		}
		for (const group of model.groups)
			for (const button of group.buttons) {
				const el = drawn.get(`${group.name}\u0000${button.id}`);
				if (!el) continue;
				el.setAttribute('aria-pressed', String(button.active));
				el.classList.toggle('hud__btn--on', button.active);
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
	/** Each button's state at the last render, so a change can name itself. */
	let shown = new Map<string, boolean>();
	/** Names a change in the controls, as a toast: a mode's new value, or a toggle's on and off. */
	const toastChanges = (model: HudModel): void => {
		const next = new Map<string, boolean>();
		for (const group of model.groups)
			for (const button of group.buttons) {
				const key = `${group.name}\u0000${button.id}`;
				next.set(key, button.active);
				const before = shown.get(key);
				if (before === undefined || before === button.active) continue;
				if (button.active)
					showToast(
						group.radio ? `${group.title}: ${button.label}`.toLowerCase() : `${button.label}: on`,
					);
				else if (!group.radio) showToast(`${button.label}: off`);
			}
		if (shown.size > 0) shown = next;
	};
	return {
		render(model, visible) {
			element.hidden = !visible;
			draw(model);
			toastChanges(model);
		},
	};
}
