import type { Provider } from '@angular/core'
import { FCMIonicBase } from '../shared.js'
import type { IFCMOptions } from '../../core/types.js'

/**
 * Angular entry: `import { FCM, provideFCM } from 'cordova-plugin-fcm-modern/ionic/ngx'`.
 *
 * Wiring is `providers: [provideFCM()]` and injection is `inject(FCM)` — the token
 * *is* the class, so a provider keyed by a string (which `inject(FCM)` can never
 * find) would be useless here. `Provider` is a type-only import, so with
 * `verbatimModuleSyntax` nothing of `@angular/core` survives in the emit: no
 * `@Injectable()` decorator and no Angular metadata at runtime are needed, and a
 * plain JS consumer of this subpath needs no Angular. Angular builds `FCM` through
 * the factory below rather than through parameter reflection, which is why the
 * class stays decorator-free and is still injectable.
 */
export class FCM extends FCMIonicBase {
    constructor(options: IFCMOptions = {}) {
        super(options)
    }
}

/**
 * Recommended wiring: `providers: [provideFCM()]`. The factory returns the shared
 * runtime-selected core, so injecting it never opens a second native sink.
 */
export const provideFCM = (options: IFCMOptions = {}): Provider => ({
    provide: FCM,
    useFactory: () => new FCM(options)
})

/** Type-only helper so an app can annotate `inject<FCM>(...)` once. */
export type FCMInjectable = FCM

export * from '../shared.js'
export * from '../../core/index.js'
