import { PowerOnError } from './errors';
import type { SyncOperationError } from './sync-utils';
import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

export type SynchronizationState =
  'verified' | 'dry-run' | 'rolled-back' | 'rollback-failed';

export interface SynchronizationResult {
  synced: string[];
  deleted: string[];
  skipped: string[];
  outliers: string[];
  errors: SyncOperationError[];
  installed?: string[];
  uninstalled?: string[];
}

export interface TransactionOperations {
  createSnapshot(): Promise<void>;
  verifyPreconditions?(): Promise<void>;
  synchronize(): Promise<SynchronizationResult>;
  verify(): Promise<void>;
  rollback(): Promise<void>;
  verifyRollback(): Promise<void>;
  cleanup(): Promise<void>;
}

export class SynchronizationTransactionError extends PowerOnError {
  readonly state: 'rolled-back' | 'rollback-failed';
  readonly synchronizationErrors: SyncOperationError[];
  readonly rollbackError?: Error;

  constructor(
    cause: unknown,
    state: 'rolled-back' | 'rollback-failed',
    synchronizationErrors: SyncOperationError[] = [],
    rollbackError?: unknown,
  ) {
    const originalError =
      cause instanceof Error ? cause : new Error(String(cause));
    const normalizedRollbackError =
      rollbackError instanceof Error
        ? rollbackError
        : rollbackError === undefined
          ? undefined
          : new Error(String(rollbackError));
    const blockerDetails = synchronizationErrors
      .map(({ file, error }) => `${file || 'synchronization'}: ${error}`)
      .join('; ');
    const rollbackDetails = normalizedRollbackError
      ? ` Rollback failed: ${normalizedRollbackError.message}. Destination state is unknown and requires operator intervention.`
      : ' The last known good state was restored and verified.';

    super(
      `Synchronization failed: ${originalError.message}${blockerDetails ? ` Blockers: ${blockerDetails}.` : ''}${rollbackDetails}`,
      {
        synchronizationState: state,
        synchronizationErrors,
        rollbackError: normalizedRollbackError?.message,
      },
      originalError,
    );
    this.state = state;
    this.synchronizationErrors = synchronizationErrors;
    this.rollbackError = normalizedRollbackError;
  }
}

async function createDirectoryManifest(
  root: string,
  relativeDirectory = '',
): Promise<Map<string, string>> {
  const manifest = new Map<string, string>();
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      const nested = await createDirectoryManifest(root, relativePath);
      nested.forEach((hash, filePath) => manifest.set(filePath, hash));
    } else if (entry.isFile()) {
      const contents = await readFile(path.join(root, relativePath));
      manifest.set(
        relativePath.replaceAll(path.sep, '/'),
        createHash('sha256').update(contents).digest('hex'),
      );
    }
  }

  return manifest;
}

export async function assertDirectoryContentsEqual(
  expectedDirectory: string,
  actualDirectory: string,
): Promise<void> {
  const [expected, actual] = await Promise.all([
    createDirectoryManifest(expectedDirectory),
    createDirectoryManifest(actualDirectory),
  ]);
  const differences = [
    ...new Set([...expected.keys(), ...actual.keys()]),
  ].filter((filePath) => expected.get(filePath) !== actual.get(filePath));

  if (differences.length > 0) {
    throw new PowerOnError(
      `Rolled back local directory differs from its snapshot: ${differences.join(', ')}`,
      { differences },
    );
  }
}

/**
 * Executes a compensating synchronization transaction. A successful return means
 * the destination was independently verified. A thrown rollback-failed error
 * means the destination state is unknown and requires operator intervention.
 */
export async function executeSynchronizationTransaction(
  operations: TransactionOperations,
  isDryRun: boolean,
): Promise<{
  result: SynchronizationResult;
  state: Extract<SynchronizationState, 'verified' | 'dry-run'>;
}> {
  let snapshotCreated = false;
  let synchronizationStarted = false;
  let result: SynchronizationResult | undefined;

  try {
    if (!isDryRun) {
      await operations.createSnapshot();
      snapshotCreated = true;
      await operations.verifyPreconditions?.();
    }

    synchronizationStarted = true;
    result = await operations.synchronize();
    if (result.errors.length > 0) {
      throw new PowerOnError(
        `Synchronization returned ${result.errors.length} failed operation${result.errors.length === 1 ? '' : 's'}`,
      );
    }

    if (!isDryRun) {
      await operations.verify();
    }

    return { result, state: isDryRun ? 'dry-run' : 'verified' };
  } catch (error) {
    if (!snapshotCreated || !synchronizationStarted) throw error;

    try {
      await operations.rollback();
      await operations.verifyRollback();
      throw new SynchronizationTransactionError(
        error,
        'rolled-back',
        result?.errors,
      );
    } catch (rollbackError) {
      if (rollbackError instanceof SynchronizationTransactionError) {
        throw rollbackError;
      }
      throw new SynchronizationTransactionError(
        error,
        'rollback-failed',
        result?.errors,
        rollbackError,
      );
    }
  } finally {
    await operations.cleanup();
  }
}
