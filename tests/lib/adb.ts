// Android phones over USB, through adb: which phone is connected, forwarding the dev server's port
// to it, opening a page in one of its browsers, and running shell commands on it.
import { execFile, execFileSync } from 'node:child_process';

/** Android package names of the browsers the runner can open. */
export const ANDROID_BROWSERS: Readonly<Record<string, string>> = {
	chrome: 'com.android.chrome',
	'chrome-beta': 'com.chrome.beta',
	brave: 'com.brave.browser',
	firefox: 'org.mozilla.firefox',
	samsung: 'com.sec.android.app.sbrowser',
};

function adb(args: string[]): string {
	return execFileSync('adb', args, { encoding: 'utf8' }).trim();
}

/** The connected phone's model number, such as SM-S926B; throws when no phone is connected. */
export function phoneModel(): string {
	const devices = adb(['devices'])
		.split('\n')
		.slice(1)
		.filter((line) => line.endsWith('\tdevice'));
	if (devices.length !== 1)
		throw new Error(
			`adb sees ${devices.length} phones; connect exactly one and allow USB debugging`,
		);
	return adb(['shell', 'getprop', 'ro.product.model']);
}

/** Makes the phone's localhost port reach the same port on this computer. */
export function forwardPort(port: number): void {
	adb(['reverse', `tcp:${port}`, `tcp:${port}`]);
}

/** Opens a page in a browser on the phone, which brings that browser to the front. */
export function openOnPhone(browser: string, url: string): void {
	const pkg = ANDROID_BROWSERS[browser];
	if (!pkg)
		throw new Error(
			`unknown Android browser ${browser}; use ${Object.keys(ANDROID_BROWSERS).join(', ')}`,
		);
	// adb runs the command through the phone's shell, so the address is quoted for its & signs.
	adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, pkg]);
}

/**
 * Runs a shell script on the phone and resolves with what it prints. It does not block this thread,
 * so a caller can read the phone while it waits for a run.
 */
export function phoneShell(script: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('adb', ['shell', script], { encoding: 'utf8' }, (error, stdout) =>
			error ? reject(error) : resolve(stdout),
		);
	});
}
