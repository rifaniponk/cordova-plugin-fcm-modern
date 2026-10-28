import assert from 'node:assert/strict'
import test from 'node:test'

import { FCMError, isFCMError, toFCMError } from '../src/core/errors.ts'

test('FCMError carries a machine-readable code and the original cause', () => {
    const cause = new Error('native boom')
    const error = new FCMError('native_error', 'getToken failed', { platform: 'android', cause })

    assert.equal(error.name, 'FCMError')
    assert.equal(error.code, 'native_error')
    assert.equal(error.message, 'getToken failed')
    assert.equal(error.platform, 'android')
    assert.equal(error.cause, cause)
    assert.ok(error instanceof Error)
})

test('isFCMError also recognises errors that crossed a realm/bridge boundary', () => {
    const crossRealm = { name: 'FCMError', code: 'timeout', message: 'timed out' }
    assert.equal(isFCMError(crossRealm), true)
    assert.equal(isFCMError(new Error('plain')), false)
    assert.equal(isFCMError(undefined), false)
    assert.equal(isFCMError('FCMError'), false)
})

test('toFCMError normalises every shape a native bridge may reject with', () => {
    assert.equal(
        toFCMError('native_error', new Error('disk full'), 'fallback').message,
        'disk full'
    )
    assert.equal(toFCMError('native_error', new Error(''), 'fallback').message, 'fallback')
    assert.equal(toFCMError('native_error', 'service down', 'fallback').message, 'service down')
    assert.equal(
        toFCMError('native_error', { message: 'json exception', cause: 'raw' }, 'fallback').message,
        'json exception'
    )
    const unknown = toFCMError('native_error', undefined, 'fallback', 'ios')
    assert.equal(unknown.message, 'fallback')
    assert.equal(unknown.platform, 'ios')
})

test('toFCMError keeps an FCMError identity instead of double-wrapping it', () => {
    const original = new FCMError('unsupported_platform', 'web is not supported')
    const wrapped = toFCMError('native_error', original, 'fallback')

    assert.equal(wrapped, original)
    assert.equal(wrapped.code, 'unsupported_platform')
})
