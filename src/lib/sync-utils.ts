import { PowerOnError } from './errors';

export interface SyncOperationError {
  file: string;
  error: string;
}

export function assertSynchronizationSucceeded(
  errors: SyncOperationError[],
): void {
  if (errors.length === 0) return;

  const details = errors
    .map(({ file, error }) => `${file || 'synchronization'}: ${error}`)
    .join('; ');

  throw new PowerOnError(
    `Synchronization completed with ${errors.length} failed operation${errors.length === 1 ? '' : 's'}: ${details}`,
    { syncErrors: errors },
  );
}
