export { FCMError, FCM_ERROR_CODES, isFCMError, toFCMError } from './errors.js';
/**
 * `FCMPlugin` is 7.x's public class name. It is an alias of the same class, not a
 * second implementation, so `new FCMPlugin(...)` and `instanceof FCMPlugin` keep
 * working for old typings while 8.x has exactly one core.
 */
export { FCMCore, FCMCore as FCMPlugin } from './fcmCore.js';
export { sharedFCM, sharedFCMKey } from './instance.js';
