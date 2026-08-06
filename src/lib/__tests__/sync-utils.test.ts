import { PowerOnError } from '../errors';
import { assertSynchronizationSucceeded } from '../sync-utils';

describe('sync-utils', () => {
  it('does not throw when every synchronization operation succeeded', () => {
    expect(() => assertSynchronizationSucceeded([])).not.toThrow();
  });

  it('throws with every failed synchronization operation', () => {
    const errors = [
      { file: 'FIRST.PO', error: 'Permission denied' },
      { file: 'SECOND.PO', error: 'Upload failed' },
    ];

    expect(() => assertSynchronizationSucceeded(errors)).toThrow(PowerOnError);
    expect(() => assertSynchronizationSucceeded(errors)).toThrow(
      'Synchronization completed with 2 failed operations: FIRST.PO: Permission denied; SECOND.PO: Upload failed',
    );
  });

  it('labels directory-level failures', () => {
    expect(() =>
      assertSynchronizationSucceeded([
        { file: '', error: 'Unable to scan directory' },
      ]),
    ).toThrow('synchronization: Unable to scan directory');
  });
});
