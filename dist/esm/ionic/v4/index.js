import { FCMIonicBase } from '../shared.js';
/**
 * Ionic v4 entry: `import { FCM, provideFCM } from 'cordova-plugin-fcm-modern/ionic/v4'`.
 *
 * Identical surface to `/ionic/ngx` — v4 dropped Ionic v3's decorator conventions
 * but the Angular injection contract is the same, so the two subpaths stay source
 * compatible for apps migrating between them. Kept as its own module because
 * package.json promises the subpath and 7.x consumers import it directly. See
 * `/ionic/ngx` for why the class carries no decorator while `provide: FCM` still
 * makes `inject(FCM)` work.
 */
export class FCM extends FCMIonicBase {
    constructor(options = {}) {
        super(options);
    }
}
export const provideFCM = (options = {}) => ({
    provide: FCM,
    useFactory: () => new FCM(options)
});
export * from '../shared.js';
export * from '../../core/index.js';
