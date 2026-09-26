export class NativeDispatchError extends Error {
  constructor(message, { cause, committed = null } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'NativeDispatchError';
    if (committed !== null && typeof committed !== 'boolean') throw new TypeError('committed must be boolean or null');
    this.committed = committed;
  }
}
