import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import type {
  MutationFileAdapter,
  MutationPlanOptions,
} from './mutation-snapshot';

export function createLocalMutationAdapter(
  directory: string,
): MutationFileAdapter {
  const filePath = (fileName: string) => path.join(directory, fileName);

  return {
    list: () => readdir(directory),
    async exists(fileName) {
      try {
        await access(filePath(fileName));
        return true;
      } catch {
        return false;
      }
    },
    read: (fileName) => readFile(filePath(fileName)),
    write: (fileName, content) => writeFile(filePath(fileName), content),
    remove: (fileName) => rm(filePath(fileName), { force: true }),
  };
}

export async function supportsCaseDistinctFileNames(
  directory: string,
): Promise<boolean> {
  const probeDirectory = await mkdtemp(
    path.join(directory, '.poweron-pipelines-case-probe-'),
  );
  const lowerCaseProbe = path.join(probeDirectory, 'caseprobe');
  const upperCaseProbe = path.join(probeDirectory, 'CASEPROBE');

  try {
    await writeFile(lowerCaseProbe, 'lower');
    await writeFile(upperCaseProbe, 'upper');
    return (await readdir(probeDirectory)).length === 2;
  } finally {
    await rm(probeDirectory, { force: true, recursive: true });
  }
}

export interface RemoteMutationOperations {
  list(): Promise<string[]>;
  download(fileName: string): Promise<Buffer>;
  deploy(fileName: string, content: Buffer): Promise<void>;
  remove(fileName: string): Promise<void>;
}

export function createRemoteMutationAdapter(
  operations: RemoteMutationOperations,
  { caseSensitiveFileNames = false }: MutationPlanOptions = {},
): MutationFileAdapter {
  const matches = (remoteFile: string, fileName: string) =>
    caseSensitiveFileNames
      ? remoteFile === fileName
      : remoteFile.toLowerCase() === fileName.toLowerCase();

  return {
    list: operations.list,
    async exists(fileName) {
      const files = await operations.list();
      return files.some((remoteFile) => matches(remoteFile, fileName));
    },
    async existsMany(fileNames) {
      const remoteFiles = await operations.list();
      return new Map(
        fileNames.map((fileName) => [
          fileName,
          remoteFiles.some((remoteFile) => matches(remoteFile, fileName)),
        ]),
      );
    },
    read: operations.download,
    write: operations.deploy,
    remove: operations.remove,
  };
}
