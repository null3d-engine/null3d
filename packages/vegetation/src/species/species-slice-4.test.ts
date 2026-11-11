// The species walk's slice 4 of four. The walk is the unit run's longest work, and a group starts only
// after the group before it ends, so the walk takes a group per slice instead of one
// ([Test memory](../../../../.dev/tests.md)). Each slice takes every fourth species, so the species
// that take longest fall in different slices rather than together.
import { sliceOf, walkedSpecies, walkSpecies } from '../../../../tests/lib/species-walk.ts';

for (const walked of sliceOf(walkedSpecies(), 3, 4)) walkSpecies(walked);
