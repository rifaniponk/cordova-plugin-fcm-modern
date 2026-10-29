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

test('toFCMError preserves a supported code from either transport wire shape', () => {
    // Capacitor rejects with an Error; the native code rides along as a field.
    const capacitor = Object.assign(new Error('the native call timed out'), { code: 'timeout' })
    const fromError = toFCMError('native_error', capacitor, 'fallback', 'ios')
    assert.equal(
        fromError.code,
        'timeout',
        '"the native side never answered" is a distinct diagnosis'
    )
    assert.equal(fromError.message, 'the native call timed out')
    assert.equal(fromError.platform, 'ios')
    assert.equal(fromError.cause, capacitor)

    // Cordova rejects with a plain dictionary, not an Error instance.
    const dict = { code: 'invalid_argument', message: 'topic name rejected' }
    const fromDict = toFCMError('native_error', dict, 'fallback', 'android')
    assert.equal(fromDict.code, 'invalid_argument')
    assert.equal(fromDict.message, 'topic name rejected')
    assert.ok(
        fromDict instanceof FCMError,
        'a dictionary rejection must still be catchable as an Error'
    )
    assert.ok(fromDict instanceof Error)
})

test('toFCMError rejects unsupported codes and always yields a real Error', () => {
    const foreign = [
        { code: 'UNIMPLEMENTED', message: 'capacitor vocabulary' },
        { code: 'invented_by_a_fork', message: 'not a contract code' },
        { code: 7, message: 'not even a string' }
    ]
    for (const raw of foreign) {
        const mapped = toFCMError('native_error', raw, 'fallback')
        assert.equal(mapped.code, 'native_error', `${raw.code} is not part of the contract`)
        assert.ok(mapped instanceof FCMError)
    }

    // An object that only *looks* like an FCMError (a second bundled copy of the
    // class, or a cross-realm rejection) is rebuilt: the caller gets a real Error
    // and the supported code survives the rebuild.
    const lookAlike = { name: 'FCMError', code: 'timeout', message: 'cross-realm timeout' }
    const rebuilt = toFCMError('native_error', lookAlike, 'fallback')
    assert.notEqual(rebuilt, lookAlike)
    assert.ok(rebuilt instanceof FCMError)
    assert.equal(rebuilt.code, 'timeout')
    assert.equal(rebuilt.message, 'cross-realm timeout')
    assert.equal(rebuilt.cause, lookAlike)
})
