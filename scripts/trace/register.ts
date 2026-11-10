// A preload that registers the engine's Node hooks (hooks.ts) before a CLI's first import, so a CLI
// whose static imports reach the engine index (Rapier, `?url` assets: the game's line list pulls
// it in through src/riftlight/lang) starts in Node: `tsx --import ./scripts/trace/register.ts <cli>`.
import { registerEngineHooks } from './hooks';

registerEngineHooks();
