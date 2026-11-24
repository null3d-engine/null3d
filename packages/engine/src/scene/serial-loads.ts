// A development build's watch for the sketch's loads that wait for one another. During the setup of
// a live start, a load whose download starts only after another load had finished, while no other
// file downloads, could have started beside it, and the scene's first frame waits for the gap. An
// earlier load is a file that arrived for one of the sketch's loads, or an environment that the
// engine made with no file, such as the built-in room. The first such load prints one warning that
// names both and the fixes. A file whose address comes from the file before it cannot start sooner:
// a load whose file name the JSON file before it holds passes, and the warning says how to turn it
// off for the other cases. Every call into this module sits behind DEV, so a production build
// leaves it out.

/** The warning for a load of `after` that started only once the load that `before` names ended. */
export function serialLoadWarning(call: string, before: string, after: URL): string {
	return `null3D: ${call}() started to download ${after} only after ${before}, while no other file downloaded, during the setup. The two could run together. Start both before you await either one, or name the files in the downloads option of defineSketch(). If the address of the second file comes from the contents of the first, the order is needed: pass serialLoadWarning: false to defineSketch() to turn this warning off.`;
}

/** The load that finished last: what the warning calls it, and its file's address if it had one. */
interface Finished {
	said: string;
	address?: string;
}

/** Watches the downloads of one engine's loading calls, and warns once for a serial load. */
export class SerialLoads {
	/** True while the sketch's loads are watched. */
	watching: () => boolean = () => false;
	/** The downloads under way, of every kind: the sketch's loads, a model's own files and the list. */
	private active = 0;
	/** The load of the sketch's that finished last. */
	private finished: Finished | undefined;
	/** The text of the last JSON file that a load read, by its address. */
	private json: { address: string; text: string } | undefined;
	private warned = false;

	constructor(private readonly say: (warning: string) => void = console.warn) {}

	/** Counts a download while it runs. */
	begin(download: Promise<unknown>): void {
		this.active++;
		const end = () => {
			this.active--;
		};
		download.then(end, end);
	}

	/** Notes the file of one of the sketch's loads once it arrives. */
	follow(download: Promise<unknown>, address: URL): void {
		download.then(
			() => {
				this.finished = { said: `${address} had arrived`, address: address.href };
			},
			() => {},
		);
	}

	/** Notes a call that made its data with no file, such as a built-in environment, as it ends. */
	made(call: string): void {
		this.finished = { said: `${call} had finished` };
	}

	/** Notes the text of a JSON file that a load read, which may name the files that follow. */
	read(address: URL, text: string): void {
		this.json = { address: address.href, text };
	}

	/**
	 * Checks a load of `address` by `call` as it begins. `fresh` is true when the load starts a
	 * download, rather than taking one that the list, a preload or another load started.
	 */
	starts(address: URL, call: string, fresh: boolean): void {
		const before = this.finished;
		if (this.warned || !fresh || this.active > 0 || !before || !this.watching()) return;
		if (before.address === address.href) return;
		const name = address.pathname.slice(address.pathname.lastIndexOf('/') + 1);
		const named = before.address !== undefined && this.json?.address === before.address;
		if (name && named && this.json?.text.includes(name)) return;
		this.warned = true;
		this.say(serialLoadWarning(call, before.said, address));
	}
}
