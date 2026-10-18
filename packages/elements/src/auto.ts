/**
 * Auto-registration entry (spec 2.1): the only intentionally side-effectful
 * artifact. Registers default hv-* names.
 */
import { registerElements } from './elements.js';

registerElements();
