// The permutation words that a page draws with, on the dev server. In a development build, the
// thread that draws hands each word to the page once, without the bits that a device fixes, and
// the engine fires an event with it on the page's global object. The null3D Vite plugin's client
// module sends the word to the dev server, which compares it with the project's shader list and
// warns about a word that the list lacks. The file imports nothing, so the plugin's tests read it
// too.

/** The event on the page's global object that carries a word that the page draws with. */
export const PERMUTATION_WORD_EVENT = 'null3d:permutation';
