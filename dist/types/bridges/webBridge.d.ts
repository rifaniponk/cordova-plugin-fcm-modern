import type { IPluginBridge } from '../core/types.js';
/**
 * There is deliberately **no** browser push implementation: web imports must not
 * crash, and every native operation must fail with an explicit, actionable error
 * instead of pretending to work or silently hanging.
 */
export declare class WebBridge implements IPluginBridge {
    readonly runtime: "web";
    readonly platformId: "web";
    call<T = unknown>(action: string): Promise<T>;
    addEventListener(): () => void;
}
