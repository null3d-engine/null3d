// A save button for a page that records its session with ?record. One tap saves the frames and
// input from the session's first frame as a file, so a bug that a phone showed can be replayed on a
// computer. The module loads only for a page that records, so no other page downloads it.

import type { Engine } from './engine';

/** The global that holds the last recording a page saved, for a tool that reads it. */
export const RECORDING_GLOBAL = '__null3dRecording';

/** The button's size on a touch screen, in CSS pixels. */
const TOUCH_SIZE = 44;

/** The name of the file that a save writes. */
function fileName(): string {
	const now = new Date();
	const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
	return `null3d-recording-${stamp}.n3dr`;
}

/** Shows the page's save button, which saves the session's recording as a file. */
export function showRecordButton(engine: Engine): void {
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = 'Save recording';
	button.setAttribute('aria-label', 'Save the recording of this session');
	Object.assign(button.style, {
		position: 'fixed',
		left: '12px',
		bottom: '12px',
		zIndex: '2147483647',
		minWidth: `${TOUCH_SIZE * 2.5}px`,
		minHeight: `${TOUCH_SIZE}px`,
		padding: '0 16px',
		border: '1px solid rgba(255, 255, 255, 0.35)',
		borderRadius: '8px',
		background: 'rgba(20, 24, 30, 0.9)',
		color: '#e6e8eb',
		font: '15px/1.2 system-ui, sans-serif',
		cursor: 'pointer',
		touchAction: 'manipulation',
	});
	button.addEventListener('click', async () => {
		button.disabled = true;
		button.textContent = 'Saving…';
		try {
			const bytes = await engine.saveRecording();
			if (bytes === undefined) {
				button.textContent = 'No recording';
				return;
			}
			(globalThis as Record<string, unknown>)[RECORDING_GLOBAL] = bytes;
			const url = URL.createObjectURL(
				new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
			);
			const link = document.createElement('a');
			link.href = url;
			link.download = fileName();
			link.click();
			// The browser keeps the bytes until the download reads them; a minute is far more than it needs.
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			button.textContent = 'Saved';
		} finally {
			button.disabled = false;
		}
	});
	document.body.append(button);
}
