import * as core from '@actions/core';
import * as exec from '@actions/exec';

export interface CommitPulledChangesConfig {
  enabled: boolean;
  isDryRun: boolean;
  syncMode: 'push' | 'pull' | 'mirror';
  localDirectoryPath: string;
  commitMessage: string;
  commitBranch?: string;
  gitUserName: string;
  gitUserEmail: string;
  logPrefix: string;
}

async function getExecOutput(command: string, args: string[], cwd?: string): Promise<string> {
  let output = '';
  await exec.exec(command, args, {
    cwd,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}

export async function commitPulledChanges(config: CommitPulledChangesConfig): Promise<void> {
  if (!config.enabled) return;

  if (config.syncMode !== 'pull') {
    throw new Error('commit-pulled-changes can only be used when sync-mode is pull');
  }

  if (config.isDryRun) {
    core.info(
      `${config.logPrefix} Dry run: commit-pulled-changes is enabled, but no commit or push will be performed.`,
    );
    return;
  }

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

  // Guard: when commit-branch is set, the checked-out HEAD must match it.
  // Otherwise the diff is computed against a different branch's tree and the
  // resulting commit silently overwrites commit-branch with that branch's content.
  if (config.commitBranch) {
    const headBranch = await getExecOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workspace);
    if (headBranch === 'HEAD') {
      throw new Error(
        `commit-branch is "${config.commitBranch}" but the workspace is in a detached HEAD state. ` +
          `Configure actions/checkout with ref: ${config.commitBranch} so drift detection and the commit target match.`,
      );
    }
    if (headBranch !== config.commitBranch) {
      throw new Error(
        `commit-branch is "${config.commitBranch}" but the checked-out branch is "${headBranch}". ` +
          `These must match — drift is computed against the working tree, and pushing to a different branch ` +
          `would silently move that branch's content. ` +
          `Configure actions/checkout with ref: ${config.commitBranch}.`,
      );
    }
  }

  await exec.exec('git', ['config', 'user.name', config.gitUserName], { cwd: workspace });
  await exec.exec('git', ['config', 'user.email', config.gitUserEmail], { cwd: workspace });
  await exec.exec('git', ['add', '--', config.localDirectoryPath], { cwd: workspace });

  const staged = await exec.exec('git', ['diff', '--cached', '--quiet'], {
    cwd: workspace,
    ignoreReturnCode: true,
    silent: true,
  });

  if (staged === 0) {
    core.info(`${config.logPrefix} No pulled changes to commit.`);
    return;
  }

  const changedFiles = await getExecOutput(
    'git',
    ['diff', '--cached', '--name-only', '--', config.localDirectoryPath],
    workspace,
  );
  core.info(`${config.logPrefix} Committing pulled changes:`);
  for (const file of changedFiles.split('\n').filter(Boolean)) {
    core.info(`${config.logPrefix}   - ${file}`);
  }

  await exec.exec('git', ['commit', '-m', config.commitMessage], { cwd: workspace });

  if (config.commitBranch) {
    await exec.exec('git', ['push', 'origin', `HEAD:${config.commitBranch}`], { cwd: workspace });
  } else {
    await exec.exec('git', ['push'], { cwd: workspace });
  }
}
