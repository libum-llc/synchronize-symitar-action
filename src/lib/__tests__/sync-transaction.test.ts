import {
  executeSynchronizationTransaction,
  SynchronizationTransactionError,
  type TransactionOperations,
} from '../sync-transaction';

function operations(
  overrides: Partial<TransactionOperations> = {},
): TransactionOperations {
  return {
    createSnapshot: jest.fn().mockResolvedValue(undefined),
    verifyPreconditions: jest.fn().mockResolvedValue(undefined),
    synchronize: jest.fn().mockResolvedValue({
      synced: ['ONE.PO'],
      deleted: [],
      skipped: [],
      outliers: [],
      errors: [],
    }),
    verify: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    verifyRollback: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('executeSynchronizationTransaction', () => {
  it('only succeeds after verification', async () => {
    const ops = operations();

    await expect(
      executeSynchronizationTransaction(ops, false),
    ).resolves.toMatchObject({
      state: 'verified',
    });
    expect(ops.createSnapshot).toHaveBeenCalledTimes(1);
    expect(ops.verifyPreconditions).toHaveBeenCalledTimes(1);
    expect(ops.verify).toHaveBeenCalledTimes(1);
    expect(ops.rollback).not.toHaveBeenCalled();
    expect(ops.cleanup).toHaveBeenCalledTimes(1);
  });

  it('rolls back and reports every returned operation error', async () => {
    const ops = operations({
      synchronize: jest.fn().mockResolvedValue({
        synced: ['ONE.PO'],
        deleted: [],
        skipped: [],
        outliers: [],
        errors: [{ file: 'TWO.PO', error: 'Permission denied' }],
      }),
    });

    await expect(
      executeSynchronizationTransaction(ops, false),
    ).rejects.toMatchObject({
      state: 'rolled-back',
      synchronizationErrors: [{ file: 'TWO.PO', error: 'Permission denied' }],
    });
    expect(ops.rollback).toHaveBeenCalledTimes(1);
    expect(ops.verifyRollback).toHaveBeenCalledTimes(1);
  });

  it('marks state unknown when rollback verification fails', async () => {
    const ops = operations({
      verify: jest.fn().mockRejectedValue(new Error('remote differs')),
      verifyRollback: jest
        .fn()
        .mockRejectedValue(new Error('snapshot differs')),
    });

    await expect(
      executeSynchronizationTransaction(ops, false),
    ).rejects.toMatchObject({
      state: 'rollback-failed',
      rollbackError: new Error('snapshot differs'),
      message: expect.stringContaining(
        'Destination state is unknown and requires operator intervention',
      ),
    });
  });

  it('does not snapshot, verify, or rollback a dry run', async () => {
    const ops = operations();

    await expect(
      executeSynchronizationTransaction(ops, true),
    ).resolves.toMatchObject({
      state: 'dry-run',
    });
    expect(ops.createSnapshot).not.toHaveBeenCalled();
    expect(ops.verify).not.toHaveBeenCalled();
    expect(ops.rollback).not.toHaveBeenCalled();
  });

  it('cannot roll back when snapshot creation fails', async () => {
    const failure = new Error('snapshot unavailable');
    const ops = operations({
      createSnapshot: jest.fn().mockRejectedValue(failure),
    });

    await expect(executeSynchronizationTransaction(ops, false)).rejects.toBe(
      failure,
    );
    expect(ops.synchronize).not.toHaveBeenCalled();
    expect(ops.rollback).not.toHaveBeenCalled();
  });

  it('does not overwrite concurrent destination drift detected before synchronization', async () => {
    const failure = new Error('concurrent destination change');
    const ops = operations({
      verifyPreconditions: jest.fn().mockRejectedValue(failure),
    });

    await expect(executeSynchronizationTransaction(ops, false)).rejects.toBe(
      failure,
    );
    expect(ops.synchronize).not.toHaveBeenCalled();
    expect(ops.rollback).not.toHaveBeenCalled();
    expect(ops.verifyRollback).not.toHaveBeenCalled();
  });

  it('returns a typed transactional error after a successful rollback', async () => {
    const ops = operations({
      synchronize: jest.fn().mockRejectedValue(new Error('connection lost')),
    });

    await expect(
      executeSynchronizationTransaction(ops, false),
    ).rejects.toBeInstanceOf(SynchronizationTransactionError);
  });
});
