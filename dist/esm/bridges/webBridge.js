import { FCMError } from '../core/errors.js';
/**
 * There is deliberately **no** browser push implementation: web imports must not
 * crash, and every native operation must fail with an explicit, actionable error
 * instead of pretending to work or silently hanging.
 */
export class WebBridge {
    runtime = 'web';
    platformId = 'web';
    call(action) {
        return Promise.reject(new FCMError('unsupported_platform', `FCM action "${action}" is unavailable on the web platform: this plugin implements Android and iOS push only. Serve web push from your own service worker instead.`, { platform: this.platformId }));
    }
    addEventListener() {
        return () => undefined;
    }
}
