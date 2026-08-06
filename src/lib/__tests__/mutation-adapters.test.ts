import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import {
  createLocalMutationAdapter,
  createRemoteMutationAdapter,
} from '../mutation-adapters';

describe('mutation adapters', () => {
  it('reads, writes, detects, and removes local destination files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mutation-adapter-'));
    const adapter = createLocalMutationAdapter(directory);
    await writeFile(path.join(directory, 'ONE'), 'before');

    await expect(adapter.list()).resolves.toEqual(['ONE']);
    await expect(adapter.exists('ONE')).resolves.toBe(true);
    await expect(adapter.read('ONE')).resolves.toEqual(Buffer.from('before'));
    await adapter.write('ONE', Buffer.from('after'));
    await expect(readFile(path.join(directory, 'ONE'), 'utf8')).resolves.toBe(
      'after',
    );
    await adapter.remove('ONE');
    await expect(adapter.exists('ONE')).resolves.toBe(false);
  });

  it('delegates remote operations and matches existence case-insensitively', async () => {
    const operations = {
      list: jest.fn().mockResolvedValue(['Existing']),
      download: jest.fn().mockResolvedValue(Buffer.from('before')),
      deploy: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const adapter = createRemoteMutationAdapter(operations);

    await expect(adapter.list()).resolves.toEqual(['Existing']);
    await expect(adapter.exists('EXISTING')).resolves.toBe(true);
    await expect(
      adapter.existsMany?.(['EXISTING', 'missing']),
    ).resolves.toEqual(
      new Map([
        ['EXISTING', true],
        ['missing', false],
      ]),
    );
    expect(operations.list).toHaveBeenCalledTimes(3);
    await adapter.read('Existing');
    await adapter.write('Existing', Buffer.from('after'));
    await adapter.remove('Existing');
    expect(operations.download).toHaveBeenCalledWith('Existing');
    expect(operations.deploy).toHaveBeenCalledWith(
      'Existing',
      Buffer.from('after'),
    );
    expect(operations.remove).toHaveBeenCalledWith('Existing');
  });

  it('matches remote filenames exactly when case-distinct names are supported', async () => {
    const operations = {
      list: jest.fn().mockResolvedValue(['Existing', 'existing']),
      download: jest.fn(),
      deploy: jest.fn(),
      remove: jest.fn(),
    };
    const adapter = createRemoteMutationAdapter(operations, {
      caseSensitiveFileNames: true,
    });

    await expect(adapter.exists('Existing')).resolves.toBe(true);
    await expect(adapter.exists('EXISTING')).resolves.toBe(false);
    await expect(
      adapter.existsMany?.(['Existing', 'existing', 'EXISTING']),
    ).resolves.toEqual(
      new Map([
        ['Existing', true],
        ['existing', true],
        ['EXISTING', false],
      ]),
    );
  });
});
