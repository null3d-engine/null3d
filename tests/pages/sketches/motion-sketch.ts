// Reports the user's motion preference as setup saw it, as it is now, and each change notice.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ preferences, page }) => {
	const atSetup = preferences.reducedMotion;
	const notices: boolean[] = [];
	preferences.onChange(() => notices.push(preferences.reducedMotion));
	page.onMessage((name) => {
		if (name === 'state')
			page.post('state', { atSetup, reducedMotion: preferences.reducedMotion, notices });
	});
	return {};
});
