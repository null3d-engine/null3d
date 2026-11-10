// Whether a local Vite server uses HTTPS, and the check that its certificate is there.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where `bun run dev-cert` writes the local certificate, from a checkout's root. */
export const DEV_CERT_DIR = 'target/dev-cert';

/**
 * True when a Vite command that serves pages uses HTTPS. That is the default, because a secure
 * origin is what makes WebGPU, and so the High and Ultra presets, available; a demo served over
 * plain HTTP on a network address silently falls back to WebGL2 at Medium. A build serves nothing,
 * so it never reads the certificate. `NULL3D_HTTPS=0` opts out, for a server that only this
 * machine reaches over the loopback, which is a secure origin already.
 */
export function servesHttps(command: 'build' | 'serve'): boolean {
	return command === 'serve' && process.env.NULL3D_HTTPS !== '0';
}

/**
 * Throws a clear message when a server needs the certificate and the checkout has none. The
 * plugin reads the certificate itself; this check runs first so the fix names the repository's step.
 */
export function requireDevCertificate(root: string): void {
	const dir = join(root, DEV_CERT_DIR);
	if (existsSync(join(dir, 'cert.pem')) && existsSync(join(dir, 'key.pem'))) return;
	throw new Error(
		`the server serves HTTPS by default, but ${dir} holds no certificate. Run "bun run dev-cert" in this checkout, or set NULL3D_HTTPS=0 to serve plain HTTP on the loopback.`,
	);
}
