import {
  assertMutationSnapshotRestored,
  assertSnapshotPreconditions,
  createMutationSnapshot,
  createPlannedFileMutations,
  restoreMutationSnapshot,
  validateMutationPlan,
  type MutationFileAdapter,
  type PlannedFileMutation,
} from '../mutation-snapshot';

function memoryAdapter(
  initial: Record<string, string> = {},
): MutationFileAdapter & { files: Map<string, Buffer>; failWrite?: string } {
  const files = new Map(
    Object.entries(initial).map(([name, content]) => [
      name,
      Buffer.from(content),
    ]),
  );
  return {
    files,
    list: async () => [...files.keys()],
    async exists(fileName) {
      return files.has(fileName);
    },
    async read(fileName) {
      const content = files.get(fileName);
      if (!content) throw new Error(`Missing ${fileName}`);
      return Buffer.from(content);
    },
    async write(fileName, content) {
      if (this.failWrite === fileName) throw new Error('write denied');
      files.set(fileName, Buffer.from(content));
    },
    async remove(fileName) {
      files.delete(fileName);
    },
  };
}

function mutation(
  fileName: string,
  operation: PlannedFileMutation['operation'],
): PlannedFileMutation {
  return { fileName, operation, target: 'remote' };
}

describe('mutation snapshot plan validation', () => {
  it('maps deployments and deletions to the selected destination', () => {
    expect(
      createPlannedFileMutations(
        { deployed: ['NEW', 'CHANGED'], deleted: ['REMOVED'] },
        'remote',
      ),
    ).toEqual([
      { fileName: 'NEW', operation: 'replace', target: 'remote' },
      { fileName: 'CHANGED', operation: 'replace', target: 'remote' },
      { fileName: 'REMOVED', operation: 'delete', target: 'remote' },
    ]);
  });

  it.each(['', '.', '..', '../BAD', 'DIR/BAD', 'DIR\\BAD', 'BAD\0FILE'])(
    'rejects unsafe filename %p',
    (fileName) => {
      expect(() =>
        validateMutationPlan([mutation(fileName, 'create')]),
      ).toThrow('Unsafe synchronization filename');
    },
  );

  it('rejects case-insensitive duplicate targets', () => {
    expect(() =>
      validateMutationPlan([
        mutation('PIPELINE_CI_ONE', 'create'),
        mutation('pipeline_ci_one', 'replace'),
      ]),
    ).toThrow('Duplicate synchronization mutation');
  });

  it('allows case-distinct targets when the destination supports them', () => {
    expect(() =>
      validateMutationPlan(
        [
          mutation('PIPELINE_CI_ONE', 'create'),
          mutation('pipeline_ci_one', 'replace'),
        ],
        { caseSensitiveFileNames: true },
      ),
    ).not.toThrow();
  });
});

describe('change-scoped mutation snapshots', () => {
  it('batches existence checks for snapshot capture and preconditions', async () => {
    const adapter = memoryAdapter({ ONE: 'one', TWO: 'two' });
    adapter.exists = jest.fn().mockRejectedValue(new Error('not batched'));
    adapter.existsMany = jest.fn(
      async (fileNames: string[]) =>
        new Map(
          fileNames.map((fileName) => [fileName, adapter.files.has(fileName)]),
        ),
    );

    const snapshot = await createMutationSnapshot(
      [mutation('ONE', 'replace'), mutation('TWO', 'replace')],
      adapter,
    );
    await expect(
      assertSnapshotPreconditions(snapshot, adapter),
    ).resolves.toBeUndefined();

    expect(adapter.exists).not.toHaveBeenCalled();
    expect(adapter.existsMany).toHaveBeenCalledTimes(2);
  });

  it('captures existence, bytes, and checksums only for planned files', async () => {
    const adapter = memoryAdapter({
      EXISTING: 'before',
      UNRELATED: 'untouched',
    });
    const snapshot = await createMutationSnapshot(
      [mutation('EXISTING', 'replace'), mutation('NEW', 'create')],
      adapter,
    );

    expect(snapshot).toEqual([
      expect.objectContaining({
        fileName: 'EXISTING',
        existedBefore: true,
        contentBefore: Buffer.from('before'),
        checksumBefore: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        fileName: 'NEW',
        existedBefore: false,
      }),
    ]);
    expect(snapshot.map(({ fileName }) => fileName)).not.toContain('UNRELATED');
  });

  it('aborts when a planned destination changes after snapshot', async () => {
    const adapter = memoryAdapter({ EXISTING: 'before' });
    const snapshot = await createMutationSnapshot(
      [mutation('EXISTING', 'replace')],
      adapter,
    );
    adapter.files.set('EXISTING', Buffer.from('concurrent change'));

    await expect(
      assertSnapshotPreconditions(snapshot, adapter),
    ).rejects.toThrow('changed after planning: EXISTING');
  });

  it('restores replaced and deleted files and removes created files', async () => {
    const adapter = memoryAdapter({
      REPLACED: 'old replacement',
      DELETED: 'old deletion',
      UNRELATED: 'untouched',
    });
    const snapshot = await createMutationSnapshot(
      [
        mutation('REPLACED', 'replace'),
        mutation('DELETED', 'delete'),
        mutation('CREATED', 'create'),
      ],
      adapter,
    );
    adapter.files.set('REPLACED', Buffer.from('new replacement'));
    adapter.files.delete('DELETED');
    adapter.files.set('CREATED', Buffer.from('new file'));

    await expect(restoreMutationSnapshot(snapshot, adapter)).resolves.toEqual(
      [],
    );
    await expect(
      assertMutationSnapshotRestored(snapshot, adapter),
    ).resolves.toBeUndefined();
    expect(adapter.files.get('REPLACED')?.toString()).toBe('old replacement');
    expect(adapter.files.get('DELETED')?.toString()).toBe('old deletion');
    expect(adapter.files.has('CREATED')).toBe(false);
    expect(adapter.files.get('UNRELATED')?.toString()).toBe('untouched');
  });

  it('continues restoration after an individual failure and reports all blockers', async () => {
    const adapter = memoryAdapter({ ONE: 'old one', TWO: 'old two' });
    const snapshot = await createMutationSnapshot(
      [mutation('ONE', 'replace'), mutation('TWO', 'replace')],
      adapter,
    );
    adapter.files.set('ONE', Buffer.from('new one'));
    adapter.files.set('TWO', Buffer.from('new two'));
    adapter.failWrite = 'ONE';

    await expect(restoreMutationSnapshot(snapshot, adapter)).resolves.toEqual([
      { fileName: 'ONE', error: 'write denied' },
    ]);
    expect(adapter.files.get('ONE')?.toString()).toBe('new one');
    expect(adapter.files.get('TWO')?.toString()).toBe('old two');
  });

  it('continues restoration when a runner rollback boundary fails for one file', async () => {
    const adapter = memoryAdapter({ ONE: 'old one', TWO: 'old two' });
    const snapshot = await createMutationSnapshot(
      [mutation('ONE', 'replace'), mutation('TWO', 'replace')],
      adapter,
    );
    adapter.files.set('ONE', Buffer.from('new one'));
    adapter.files.set('TWO', Buffer.from('new two'));

    await expect(
      restoreMutationSnapshot(snapshot, adapter, {
        beforeRestore: async ({ fileName }) => {
          if (fileName === 'ONE') throw new Error('injected restore failure');
        },
      }),
    ).resolves.toEqual([
      { fileName: 'ONE', error: 'injected restore failure' },
    ]);
    expect(adapter.files.get('ONE')?.toString()).toBe('new one');
    expect(adapter.files.get('TWO')?.toString()).toBe('old two');
  });
});
