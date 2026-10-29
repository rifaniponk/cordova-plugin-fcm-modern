// AOT fixture: the only thing that proves the Angular entry survives a real ngc
// run — decorator-free injection (`inject(FCM)`), `provideFCM()` as a provider,
// and an Observable from the Ionic wrappers must all compile through Angular's
// own linker, not merely through tsc. Compiled by scripts/ngc-fixture.mjs and
// never imported by a unit test, so it resolves the package subpath exactly like
// a published consumer does — through dist/, which is what npm ships. The fixture
// tsconfig maps that specifier to ./dist/types/ionic/ngx/index.d.ts, so ngc sees
// the same declaration surface an app would see after `npm install`.
import { signal } from '@angular/core'
import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { FCM, provideFCM } from 'cordova-plugin-fcm-modern/ionic/ngx'

@Component({
    selector: 'fcm-consumer',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (token(); as value) {
            <p class="token">{{ value }}</p>
        }
    `,
    providers: [provideFCM({ autoInitialize: false })]
})
export class FcmConsumerComponent {
    private readonly fcm = inject(FCM)
    protected readonly token = signal<string | null>(null)
    protected readonly lastMessageId = signal<string>('')

    /** Every call here is a real API of the injected wrapper, typed by its .d.ts. */
    public async load(): Promise<void> {
        await this.fcm.initialize()
        for (const topic of ['news', '9lives']) {
            await this.fcm.subscribeToTopic(topic)
        }
        this.token.set(await this.fcm.getToken())
        const subscription = this.fcm.onNotification({ once: true }).subscribe((payload) => {
            this.lastMessageId.set(payload.messageId ?? '')
        })
        subscription.unsubscribe()
    }

    public async release(): Promise<void> {
        await this.fcm.deleteToken()
        this.fcm.dispose()
    }
}
