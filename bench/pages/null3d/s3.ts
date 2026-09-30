// The page of the null3d version of s3; the scene runs in its sketch module.
import { S3_DEFAULT_COUNT } from '../../scenes/spec';
import { runNull3dPage } from './harness';

runNull3dPage('s3', new URL('./s3-sketch.ts', import.meta.url), S3_DEFAULT_COUNT);
