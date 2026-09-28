/**
 * Preload for acceptance worker processes (`node --import register.js`):
 * registers the resolve hook that instruments the facade's host adapter
 * before the facade is first imported.
 */
import { register } from 'node:module';

register(new URL('./host-hooks.js', import.meta.url));
