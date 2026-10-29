/*
 * Node's native type-stripping loader resolves a specifier exactly as written.
 * The sources use explicit `.js` extensions (required so the emitted ESM build is
 * valid for Node and bundlers), so running tests straight against the TypeScript
 * sources needs the one-step `.js` to `.ts` remap that a bundler would do.
 *
 * Loaded with `node --import ./scripts/ts-js-hook.mjs`; production code never
 * sees this file.
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            if (specifier.endsWith('.js')) {
                const parentURL = context.parentURL ?? context.url
                const candidate = new URL(specifier.replace(/\.js$/, '.ts'), parentURL)
                if (existsSync(fileURLToPath(candidate))) {
                    return { url: candidate.href, shortCircuit: true, format: 'module-typescript' }
                }
            }
        }
        return nextResolve(specifier, context)
    }
})
