// A page that loads one foundation add-on twice: once as this checkout ships it, and once as an
// older build of the same add-on that pinned an earlier engine version. The second import must
// stop the page with E1432, which names the add-on, its version and the engine's version, before
// anything draws. The test reads the browser's own error and checks that the page never started.
import '@null3d/impostors';
import '../fixtures/stale-impostors';

const status = document.querySelector('#status') as HTMLPreElement;
status.textContent = 'both versions loaded';
