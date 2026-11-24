// A demo's toast: names a setting's new value at the top of the view when a demo changes it with a
// key, as the showcase scenes' controls do. A new toast replaces the one before it, it fades after a
// moment, and it never takes a click. A sketch posts one with `page.post('toast', text)`.
/** How long a toast stays before it fades, in ms. */
const SHOWN_FOR = 2000;

export interface Toast {
	/** Shows a line for a moment, replacing any line that is showing. */
	show(text: string): void;
	/** Takes the toast away and stops its timer. */
	dispose(): void;
}

/** Makes the toast for a demo's stage. */
export function createToast(stage: HTMLElement): Toast {
	const element = document.createElement('div');
	element.className = 'hud__toast';
	element.dataset.demoToast = '';
	stage.append(element);
	let timer: ReturnType<typeof setTimeout> | 0 = 0;
	return {
		show(text) {
			clearTimeout(timer);
			element.textContent = text;
			element.classList.add('show');
			timer = setTimeout(() => element.classList.remove('show'), SHOWN_FOR);
		},
		dispose() {
			clearTimeout(timer);
			element.remove();
		},
	};
}

/** Reads a sketch's toast messages, which carry the line to show as their value. */
export function toastReader(toast: Toast): (type: string, data: unknown) => void {
	return (type, data) => {
		if (type !== 'toast') return;
		const text = typeof data === 'string' ? data : '';
		if (text) toast.show(text);
	};
}
