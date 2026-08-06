import {
  applyForwardScope,
  applyPullScope,
  matchesSyncPattern,
} from '../sync-scope';

describe('synchronization pull scope', () => {
  it('supports exact, star, question-mark, and case-insensitive patterns', () => {
    expect(matchesSyncPattern('PIPELINE_CI_ONE', 'PIPELINE_CI_*')).toBe(true);
    expect(matchesSyncPattern('help1', 'HELP?')).toBe(true);
    expect(matchesSyncPattern('OTHER', 'PIPELINE_CI_*')).toBe(false);
  });

  it('filters changed files to pull-preserved authority', () => {
    expect(
      applyPullScope(
        {
          deployed: ['PIPELINE_CI_ONE', 'UNRELATED'],
          deleted: ['LOCAL_ONLY'],
        },
        ['PIPELINE_CI_*'],
        true,
      ),
    ).toEqual({ deployed: ['PIPELINE_CI_ONE'], deleted: [] });
  });

  it('returns no changes when filtered pull has no patterns', () => {
    expect(
      applyPullScope(
        { deployed: ['PIPELINE_CI_ONE'], deleted: ['LOCAL_ONLY'] },
        [],
        true,
      ),
    ).toEqual({ deployed: [], deleted: [] });
  });

  it('does not alter ordinary pulls', () => {
    const changed = { deployed: ['ONE'], deleted: ['TWO'] };
    expect(applyPullScope(changed, ['OTHER'], false)).toBe(changed);
  });
});

describe('synchronization forward scope', () => {
  it('removes preserved deployments and deletions from transaction authority', () => {
    expect(
      applyForwardScope(
        {
          deployed: ['OWNED_PRIMARY', 'SERVER_ONE', 'SERVER_TWO'],
          deleted: ['OWNED_EXTRA', 'SERVER_THREE'],
        },
        ['SERVER_*'],
      ),
    ).toEqual({
      deployed: ['OWNED_PRIMARY'],
      deleted: ['OWNED_EXTRA'],
    });
  });

  it('does not alter changes when no preservation scope exists', () => {
    const changed = { deployed: ['ONE'], deleted: ['TWO'] };
    expect(applyForwardScope(changed, [])).toBe(changed);
  });
});
