// A module that defines a sketch but exports it by name, where a sketch module must export it as its
// default export. The engine rejects a start with it with E1401.
import { defineSketch } from '@null3d/engine';

export const sketch = defineSketch(() => ({}));
