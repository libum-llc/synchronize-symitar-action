import { createHash } from 'crypto';

import { PowerOnError } from './errors';

export interface PlannedFileMutation {
  fileName: string;
  operation: 'create' | 'replace' | 'delete';
  target: 'local' | 'remote';
}

export interface FileSnapshotEntry extends PlannedFileMutation {
  existedBefore: boolean;
  checksumBefore?: string;
  contentBefore?: Buffer;
}

export interface MutationFileAdapter {
  list(): Promise<string[]>;
  exists(fileName: string): Promise<boolean>;
  existsMany?(fileNames: string[]): Promise<Map<string, boolean>>;
  read(fileName: string): Promise<Buffer>;
  write(fileName: string, content: Buffer): Promise<void>;
  remove(fileName: string): Promise<void>;
}

export interface MutationRecoveryError {
  fileName: string;
  error: string;
}

export interface RestoreMutationSnapshotOptions {
  beforeRestore?(entry: FileSnapshotEntry): Promise<void>;
}

export interface MutationPlanOptions {
  caseSensitiveFileNames?: boolean;
}

export function createPlannedFileMutations(
  changed: { deployed: string[]; deleted: string[] },
  target: PlannedFileMutation['target'],
): PlannedFileMutation[] {
  return [
    ...changed.deployed.map((fileName) => ({
      fileName,
      operation: 'replace' as const,
      target,
    })),
    ...changed.deleted.map((fileName) => ({
      fileName,
      operation: 'delete' as const,
      target,
    })),
  ];
}

function checksum(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function validateFileName(fileName: string): void {
  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('\0')
  ) {
    throw new PowerOnError(`Unsafe synchronization filename: ${fileName}`, {
      fileName,
    });
  }
}

export function validateMutationPlan(
  plan: PlannedFileMutation[],
  { caseSensitiveFileNames = false }: MutationPlanOptions = {},
): void {
  const seen = new Set<string>();
  for (const mutation of plan) {
    validateFileName(mutation.fileName);
    const fileName = caseSensitiveFileNames
      ? mutation.fileName
      : mutation.fileName.toLowerCase();
    const key = `${mutation.target}:${fileName}`;
    if (seen.has(key)) {
      throw new PowerOnError(
        `Duplicate synchronization mutation: ${mutation.fileName}`,
        { fileName: mutation.fileName, target: mutation.target },
      );
    }
    seen.add(key);
  }
}

export async function createMutationSnapshot(
  plan: PlannedFileMutation[],
  adapter: MutationFileAdapter,
  options: MutationPlanOptions = {},
): Promise<FileSnapshotEntry[]> {
  validateMutationPlan(plan, options);

  const existence = adapter.existsMany
    ? await adapter.existsMany(plan.map(({ fileName }) => fileName))
    : undefined;
  const snapshot: FileSnapshotEntry[] = [];

  for (const mutation of plan) {
    const existedBefore =
      existence?.get(mutation.fileName) ??
      (await adapter.exists(mutation.fileName));
    if (!existedBefore) {
      snapshot.push({
        ...mutation,
        operation:
          mutation.operation === 'delete' ? 'delete' : ('create' as const),
        existedBefore,
      });
      continue;
    }

    const contentBefore = await adapter.read(mutation.fileName);
    snapshot.push({
      ...mutation,
      operation:
        mutation.operation === 'delete' ? 'delete' : ('replace' as const),
      existedBefore,
      checksumBefore: checksum(contentBefore),
      contentBefore,
    });
  }

  return snapshot;
}

export async function assertSnapshotPreconditions(
  snapshot: FileSnapshotEntry[],
  adapter: MutationFileAdapter,
): Promise<void> {
  const drifted: string[] = [];
  const existence = adapter.existsMany
    ? await adapter.existsMany(snapshot.map(({ fileName }) => fileName))
    : undefined;

  for (const entry of snapshot) {
    const exists =
      existence?.get(entry.fileName) ?? (await adapter.exists(entry.fileName));
    if (exists !== entry.existedBefore) {
      drifted.push(entry.fileName);
      continue;
    }
    if (!exists) continue;

    const actualChecksum = checksum(await adapter.read(entry.fileName));
    if (actualChecksum !== entry.checksumBefore) {
      drifted.push(entry.fileName);
    }
  }

  if (drifted.length > 0) {
    throw new PowerOnError(
      `Synchronization destination changed after planning: ${drifted.join(', ')}`,
      { driftedFiles: drifted },
    );
  }
}

export async function restoreMutationSnapshot(
  snapshot: FileSnapshotEntry[],
  adapter: MutationFileAdapter,
  options: RestoreMutationSnapshotOptions = {},
): Promise<MutationRecoveryError[]> {
  const errors: MutationRecoveryError[] = [];

  for (const entry of snapshot) {
    try {
      await options.beforeRestore?.(entry);
      if (entry.existedBefore) {
        if (!entry.contentBefore) {
          throw new Error('Snapshot content is missing');
        }
        await adapter.write(entry.fileName, entry.contentBefore);
      } else if (await adapter.exists(entry.fileName)) {
        await adapter.remove(entry.fileName);
      }
    } catch (error) {
      errors.push({
        fileName: entry.fileName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return errors;
}

export async function assertMutationSnapshotRestored(
  snapshot: FileSnapshotEntry[],
  adapter: MutationFileAdapter,
): Promise<void> {
  await assertSnapshotPreconditions(snapshot, adapter);
}
