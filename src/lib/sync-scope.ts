export function matchesSyncPattern(fileName: string, pattern: string): boolean {
  const escape = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  const source = pattern
    .split('*')
    .map((part) => part.split('?').map(escape).join('.'))
    .join('.*');
  return new RegExp(`^${source}$`, 'i').test(fileName);
}

export function applyPullScope<
  T extends { deployed: string[]; deleted: string[] },
>(changed: T, preserveServerFiles: string[], pullPreservedOnly: boolean): T {
  if (!pullPreservedOnly) return changed;
  return {
    ...changed,
    deployed:
      preserveServerFiles.length === 0
        ? []
        : changed.deployed.filter((fileName) =>
            preserveServerFiles.some((pattern) =>
              matchesSyncPattern(fileName, pattern),
            ),
          ),
    deleted: [],
  };
}

export function applyForwardScope<
  T extends { deployed: string[]; deleted: string[] },
>(changed: T, preserveServerFiles: string[]): T {
  if (preserveServerFiles.length === 0) return changed;
  const isPreserved = (fileName: string) =>
    preserveServerFiles.some((pattern) =>
      matchesSyncPattern(fileName, pattern),
    );
  return {
    ...changed,
    deployed: changed.deployed.filter((fileName) => !isPreserved(fileName)),
    deleted: changed.deleted.filter((fileName) => !isPreserved(fileName)),
  };
}
