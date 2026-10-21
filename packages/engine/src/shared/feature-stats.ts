// The name of the sketch message that carries an add-on feature's figures to the page, where the
// stats overlay shows them. The feature host sends it whenever a figure changes, and the page keeps
// the newest list. No other module imports the feature code for this name, so a page that uses no
// add-on feature downloads none of it.

/** The sketch message name that carries the features' figures to the page. */
export const FEATURE_STATS_MESSAGE = 'null3d:feature-stats';
