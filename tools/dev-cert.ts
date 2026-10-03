// Makes a local HTTPS certificate for the dev server, signed by a certificate authority that lives
// in this repository's build folder. The computer's own trust store is left alone. To test on an
// iPad or iPhone, install the printed rootCA.pem on the device and trust it. The certificate also
// names bs-local.com, the name by which BrowserStack's devices reach this computer.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { localHostName } from './lib/host.ts';

const root = process.cwd();
const caDir = join(root, 'target/dev-ca');
const certDir = join(root, 'target/dev-cert');

try {
	execFileSync('mkcert', ['-help'], { stdio: 'ignore' });
} catch {
	console.error('mkcert is not installed. On macOS: brew install mkcert');
	process.exit(1);
}

mkdirSync(caDir, { recursive: true });
mkdirSync(certDir, { recursive: true });
const host = `${localHostName()}.local`;
execFileSync(
	'mkcert',
	[
		'-cert-file',
		join(certDir, 'cert.pem'),
		'-key-file',
		join(certDir, 'key.pem'),
		'localhost',
		'127.0.0.1',
		'::1',
		host,
		'bs-local.com',
	],
	{ stdio: 'inherit', env: { ...process.env, CAROOT: caDir } },
);
console.log(
	`\nThe certificate covers localhost, ${host}, and bs-local.com for BrowserStack Local.`,
);
console.log(
	`To test on an iPad or iPhone, AirDrop ${join(caDir, 'rootCA.pem')} to the device, install it,`,
);
console.log('then turn on full trust in Settings > General > About > Certificate Trust Settings.');
