// Preloaded in every test worker (`--import`): registers the resolve hook of workerHooks.mjs.
import { register } from 'node:module';

register(new URL('./workerHooks.mjs', import.meta.url));
