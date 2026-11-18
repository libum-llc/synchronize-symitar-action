import fs from 'fs';
import os from 'os';
import path from 'path';
const fixture = require('../scripts/integration/fixtures.js');

describe('run-owned live synchronization fixture safeguards', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'action-fixture-test-'));
    process.chdir(workspace);
    process.env.LIVE_HOSTNAME = 'symitar.example';
    process.env.LIVE_SSH_USERNAME = 'fixture-user';
    process.env.LIVE_SYM_NUMBER = '123';
    process.env.LIVE_SYM_USER_NUMBER = '100';
    process.env.GITHUB_RUN_ID = '123';
    process.env.GITHUB_RUN_ATTEMPT = '1';
    process.env.GITHUB_OUTPUT = path.join(workspace, 'output');
    fixture.prepare();
  });
  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const client = () => ({
    listFiles: jest.fn(),
    downloadFile: jest.fn(),
    removeFile: jest.fn(),
  });
  it('refuses an existing remote filename without overwriting or deleting it', async () => {
    const c = client();
    c.listFiles.mockResolvedValue(['GHS_123_1_BYTES']);
    await expect(fixture.control('check-absent', c)).rejects.toThrow(
      'already exists',
    );
    expect(c.removeFile).not.toHaveBeenCalled();
    expect(c.downloadFile).not.toHaveBeenCalled();
  });
  it('verifies exact remote bytes and absence after targeted cleanup', async () => {
    const c = client();
    c.listFiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['GHS_123_1_BYTES', 'UNRELATED'])
      .mockResolvedValueOnce(['UNRELATED']);
    c.downloadFile.mockResolvedValue(fixture.content());
    await fixture.control('check-absent', c);
    await fixture.control('cleanup', c);
    expect(c.removeFile).toHaveBeenCalledTimes(1);
    expect(c.removeFile).toHaveBeenCalledWith('HELPFILES', 'GHS_123_1_BYTES');
    expect(fixture.readJournal().state).toBe('cleaned');
  });
  it('leaves changed remote content untouched', async () => {
    const c = client();
    c.listFiles
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['GHS_123_1_BYTES']);
    c.downloadFile.mockResolvedValue(Buffer.from('changed by someone else'));
    await fixture.control('check-absent', c);
    await expect(fixture.control('cleanup', c)).rejects.toThrow(
      'refusing cleanup',
    );
    expect(c.removeFile).not.toHaveBeenCalled();
  });
  it('rejects a foreign run journal before any remote operation', async () => {
    process.env.GITHUB_RUN_ID = '456';
    const c = client();
    await expect(fixture.control('cleanup', c)).rejects.toThrow();
    expect(c.listFiles).not.toHaveBeenCalled();
  });
  it('refuses cleanup when the configured target changes', async () => {
    process.env.LIVE_HOSTNAME = 'different.example';
    const c = client();
    await expect(fixture.control('cleanup', c)).rejects.toThrow(
      'Fixture target configuration changed',
    );
    expect(c.listFiles).not.toHaveBeenCalled();
    expect(c.removeFile).not.toHaveBeenCalled();
  });
  it('detects line-ending or binary-byte normalization and dry-run writes', () => {
    const target = '.integration-fixtures/pull/GHS_123_1_BYTES';
    fs.writeFileSync(target, fixture.content());
    expect(() => fixture.verifyLocal()).not.toThrow();
    fs.writeFileSync(target, fixture.content().toString('utf8'));
    expect(() => fixture.verifyLocal()).toThrow('Pulled bytes differ');
    fs.writeFileSync(target, fixture.content());
    fs.writeFileSync('.integration-fixtures/preview/UNEXPECTED', 'oops');
    expect(() => fixture.verifyLocal()).toThrow('dry run wrote files');
  });
});
