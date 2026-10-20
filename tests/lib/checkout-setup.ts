// Playwright's global setup that refuses a run whose dev server serves another copy of the
// repository. The dev server entry reuses a server that already answers on its port, off CI, and
// every copy takes the same port unless NULL3D_PORT names another. A run could then draw another
// copy's code and judge it against this copy's references. Playwright starts its web servers
// before the global setups, so the server that the run will use already answers here.
import { HTTP_PORT, refuseOtherCopy } from './server.ts';

export default function globalSetup(): Promise<void> {
	return refuseOtherCopy(`http://localhost:${HTTP_PORT}`);
}
