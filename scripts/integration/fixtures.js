const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const root = '.integration-fixtures';
const journal = '.integration-results/fixture.json';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixtureName(runId, attempt) {
  assert.match(runId, /^\d+$/);
  assert.match(attempt, /^\d+$/);
  return `GHS_${runId}_${attempt}_BYTES`;
}
function content() {
  return Buffer.concat([
    Buffer.from(
      'GitHub Action byte preservation\r\nLF line\nno normalization\r\n',
    ),
    Buffer.from([0, 128, 255, 13, 10, 26]),
  ]);
}
function targetConfiguration() {
  const values = [
    'LIVE_HOSTNAME',
    'LIVE_SSH_USERNAME',
    'LIVE_SYM_NUMBER',
    'LIVE_SYM_USER_NUMBER',
  ].map((key) => {
    const value = process.env[key]?.trim();
    assert.ok(value, `Missing ${key}; no live connection attempted.`);
    return value;
  });
  assert.match(values[2], /^\d{1,3}$/);
  return {
    host: values[0],
    username: values[1],
    sym: Number(values[2]),
    user: values[3],
    fingerprint: hash(Buffer.from(JSON.stringify(values))),
  };
}
function prepare() {
  const name = fixtureName(
    process.env.GITHUB_RUN_ID,
    process.env.GITHUB_RUN_ATTEMPT,
  );
  assert.ok(!fs.existsSync(root), 'Fixture workspace already exists');
  for (const dir of ['push', 'pull', 'preview', 'nomatch', 'empty'])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.mkdirSync('.integration-results', { recursive: true });
  const bytes = content();
  fs.writeFileSync(path.join(root, 'push', name), bytes);
  fs.writeFileSync(
    journal,
    JSON.stringify(
      {
        name,
        sha256: hash(bytes),
        target: 'HELPFILES',
        configuration: targetConfiguration().fingerprint,
        state: 'unverified',
      },
      null,
      2,
    ),
  );
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `name=${name}\n`);
}
function readJournal() {
  const data = JSON.parse(fs.readFileSync(journal, 'utf8'));
  assert.equal(
    data.name,
    fixtureName(process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT),
  );
  assert.equal(data.target, 'HELPFILES');
  assert.equal(
    data.configuration,
    targetConfiguration().fingerprint,
    'Fixture target configuration changed',
  );
  assert.equal(data.sha256, hash(content()));
  return data;
}
function writeJournal(data, state) {
  fs.writeFileSync(journal, JSON.stringify({ ...data, state }, null, 2));
}
function verifyLocal() {
  const data = readJournal();
  const pulled = fs.readdirSync(path.join(root, 'pull'));
  assert.equal(pulled.length, 1);
  assert.equal(pulled[0], data.name);
  assert.ok(
    fs.readFileSync(path.join(root, 'pull', data.name)).equals(content()),
    'Pulled bytes differ',
  );
  assert.ok(
    fs.readFileSync(path.join(root, 'push', data.name)).equals(content()),
    'Source bytes changed',
  );
  for (const dir of ['preview', 'nomatch', 'empty'])
    assert.equal(
      fs.readdirSync(path.join(root, dir)).length,
      0,
      `${dir} dry run wrote files`,
    );
}
// The control client only verifies/removes this run's exact file. The Action
// itself performs every transfer. Never call this after an unsuccessful Action.
async function control(mode, client) {
  const data = readJournal();
  const files = await client.listFiles('HELPFILES');
  const exists = files.some((file) => file.toUpperCase() === data.name);
  if (mode === 'check-absent') {
    assert.equal(
      exists,
      false,
      'Run-owned name already exists; refusing to overwrite',
    );
    writeJournal(data, 'absence-verified');
  } else {
    assert.equal(mode, 'cleanup');
    assert.equal(data.state, 'absence-verified');
    assert.equal(exists, true, 'Pushed file is missing');
    assert.ok(
      (await client.downloadFile('HELPFILES', data.name)).equals(content()),
      'Remote bytes changed; refusing cleanup',
    );
    await client.removeFile('HELPFILES', data.name);
    assert.ok(
      !(await client.listFiles('HELPFILES')).some(
        (file) => file.toUpperCase() === data.name,
      ),
      'Cleanup did not remove fixture',
    );
    writeJournal(data, 'cleaned');
  }
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'prepare') return prepare();
  if (mode === 'verify-local') return verifyLocal();
  assert.ok(['check-absent', 'cleanup'].includes(mode));
  readJournal(); // All ownership checks precede authentication.
  const { createQuestClient } = require('@libum-llc/pipelines-core');
  const target = targetConfiguration();
  const client = await createQuestClient({
    symitarHostname: target.host,
    sshPort: 22,
    sshUsername: target.username,
    symNumber: target.sym,
    symitarUserNumber: target.user,
    debug: false,
    sshPassword: process.env.AIX_PASSWORD,
    symitarUserPassword: process.env.SYM_PASSWORD,
    sshHostKey: process.env.HOST_KEY,
    logPrefix: '[LiveFixture]',
  });
  try {
    await control(mode, client);
  } finally {
    await client.end();
  }
}
if (require.main === module) {
  const timeout = setTimeout(() => {
    console.error(
      'Fixture operation timed out; no retry or recovery login permitted.',
    );
    process.exit(1);
  }, 90000);
  main().then(
    () => {
      clearTimeout(timeout);
      process.exit(0);
    },
    (error) => {
      clearTimeout(timeout);
      // Authentication errors may carry credentials in nested context; do not dump them.
      console.error(
        `Fixture operation failed (${error.name}); inspect the fixture journal before any new connection.`,
      );
      process.exit(1);
    },
  );
}
module.exports = {
  content,
  hash,
  fixtureName,
  prepare,
  readJournal,
  control,
  verifyLocal,
};
