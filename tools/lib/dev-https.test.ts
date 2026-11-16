import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEV_CERT_DIR, requireDevCertificate, servesHttps } from './dev-https.ts';

/** Puts NULL3D_HTTPS back as it was after each check. */
const before = process.env.NULL3D_HTTPS;
afterEach(() => {
	if (before === undefined) delete process.env.NULL3D_HTTPS;
	else process.env.NULL3D_HTTPS = before;
});

describe('servesHttps', () => {
	it('serves HTTPS by default, and a build serves nothing', () => {
		delete process.env.NULL3D_HTTPS;
		expect(servesHttps('serve')).toBe(true);
		expect(servesHttps('build')).toBe(false);
	});

	it('opts out with NULL3D_HTTPS=0', () => {
		process.env.NULL3D_HTTPS = '0';
		expect(servesHttps('serve')).toBe(false);
	});
});

describe('requireDevCertificate', () => {
	it('names the fix when the certificate is missing, and passes when it is there', () => {
		const root = mkdtempSync(join(tmpdir(), 'null3d-cert-'));
		try {
			expect(() => requireDevCertificate(root)).toThrow('bun run dev-cert');
			const dir = join(root, DEV_CERT_DIR);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, 'cert.pem'), '');
			writeFileSync(join(dir, 'key.pem'), '');
			expect(() => requireDevCertificate(root)).not.toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
