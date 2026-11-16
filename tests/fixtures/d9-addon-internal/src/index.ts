// The fixture add-on's entry: it declares the plugin interface that it was built for, then imports
// an engine entry point that a listing refuses. The listing check must stop on that import.
import { checkPluginInterface, PLUGIN_INTERFACE_VERSION } from '@null3d/engine';
import { SHADERS } from '@null3d/engine/internal';

checkPluginInterface('d9-addon-internal-fixture', {
	min: PLUGIN_INTERFACE_VERSION,
	max: PLUGIN_INTERFACE_VERSION,
});

export const shaders = SHADERS;
