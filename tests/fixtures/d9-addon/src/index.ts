// The fixture add-on's entry: it declares the plugin interface that it was built for, as an add-on
// from another developer does, and exports nothing that a page uses.
import { checkPluginInterface, PLUGIN_INTERFACE_VERSION } from '@null3d/engine';

checkPluginInterface('d9-addon-fixture', {
	min: PLUGIN_INTERFACE_VERSION,
	max: PLUGIN_INTERFACE_VERSION,
});

export const ok = true;
