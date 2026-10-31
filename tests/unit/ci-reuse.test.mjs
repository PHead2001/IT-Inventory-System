// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  assertSameEvidence,
  createGitHubReader,
  findReusableValidation,
  formatReuseSummary,
  verifyWorkflowSource,
} from '../../scripts/ci-reuse.mjs';
import {
  foundationStepNames,
  fullCompletionStepName,
  requiredDecisionStepName,
  workflowSourceStepPrefix,
} from '../../scripts/ci-gates.mjs';
import { assertRequiredValidation } from '../../scripts/ci-required.mjs';

const sha = (letter) => letter.repeat(40);
const targetSha = sha('a');
const sourceSha = sha('b');
const treeSha = sha('c');
const workflowSha = sha('d');
const repository = 'owner/inventory';
const repo = { id: 7, full_name: repository };
const localWorkflow = Buffer.from('reviewed workflow bytes\n');
const now = Date.parse('2026-10-08T12:00:00Z');
const successfulStep = (name) => ({
  name,
  status: 'completed',
  conclusion: 'success',
});

function fixture() {
  const run = {
    id: 100,
    run_attempt: 2,
    workflow_id: 50,
    path: '.github/workflows/ci.yml',
    event: 'pull_request',
    head_sha: sourceSha,
    repository: { ...repo },
    head_repository: { ...repo },
    // GitHub can remove this array's entries after merge. The authoritative
    // commit->merged-PR->head association is independently checked below.
    pull_requests: [],
    status: 'completed',
    conclusion: 'success',
    run_started_at: '2026-10-08T10:00:00Z',
    updated_at: '2026-10-08T11:00:00Z',
  };
  const pr = {
    number: 8,
    merged: true,
    state: 'closed',
    merge_commit_sha: targetSha,
    merged_at: '2026-10-08T11:30:00Z',
    base: { ref: 'main', repo: { ...repo } },
    head: { sha: sourceSha, repo: { ...repo } },
  };
  const job = {
    id: 200,
    name: 'required',
    run_id: run.id,
    run_attempt: run.run_attempt,
    head_sha: sourceSha,
    started_at: '2026-10-08T10:01:00Z',
    completed_at: '2026-10-08T10:59:00Z',
    status: 'completed',
    conclusion: 'success',
    steps: [
      ...Object.values(foundationStepNames),
      workflowSourceStepPrefix + workflowSha,
      fullCompletionStepName,
      requiredDecisionStepName,
    ].map(successfulStep),
  };
  const contents = {
    type: 'file',
    path: '.github/workflows/ci.yml',
    encoding: 'base64',
    size: localWorkflow.length,
    content: localWorkflow.toString('base64'),
  };
  const state = {
    workflow: { id: 50, path: '.github/workflows/ci.yml', state: 'active' },
    target: { sha: targetSha, tree: { sha: treeSha } },
    source: { sha: sourceSha, tree: { sha: treeSha } },
    associations: [{ number: pr.number, merge_commit_sha: targetSha }],
    pr,
    run,
    runs: [run],
    jobs: [job],
    contents,
  };
  const reader = {
    get: vi.fn(async (path) => {
      if (path === '/actions/workflows/ci.yml') return state.workflow;
      if (path === `/git/commits/${targetSha}`) return state.target;
      if (path === `/git/commits/${sourceSha}`) return state.source;
      if (path === '/pulls/8') return state.pr;
      if (path === '/actions/runs/100') return structuredClone(state.run);
      if (path.startsWith('/contents/')) return state.contents;
      throw new Error('Unexpected fixture endpoint ' + path);
    }),
    pages: vi.fn(async (path) => {
      if (path === `/commits/${targetSha}/pulls`) return state.associations;
      if (path.startsWith('/actions/workflows/50/runs?'))
        return structuredClone(state.runs);
      if (path === '/actions/runs/100/attempts/2/jobs') return state.jobs;
      throw new Error('Unexpected fixture pagination ' + path);
    }),
  };
  const options = {
    repository,
    repositoryId: repo.id,
    targetSha,
    event: 'push',
    ref: 'refs/heads/main',
    localWorkflow,
    reader,
    now,
  };
  return {
    state,
    reader,
    options,
    evaluate: () => findReusableValidation(options),
  };
}

describe('verified main validation reuse', () => {
  it.each(['merge', 'squash'])(
    'accepts %s with distinct commits and the same whole Git tree',
    async () => {
      const f = fixture();
      expect(sourceSha).not.toBe(targetSha);
      expect(await f.evaluate()).toEqual({
        reuse: true,
        targetSha,
        sourceSha,
        treeSha,
        workflowSha,
        workflowId: 50,
        runId: 100,
        runAttempt: 2,
        prNumber: 8,
        jobId: 200,
        jobCompletedAt: f.state.jobs[0].completed_at,
        runCompletedAt: f.state.run.updated_at,
      });
      expect(f.reader.pages).toHaveBeenCalledWith(
        '/actions/runs/100/attempts/2/jobs',
        'jobs',
      );
    },
  );

  it('accepts a consistent optional run PR association', async () => {
    const f = fixture();
    f.state.run.pull_requests = [
      { number: 8, head: f.state.pr.head, base: f.state.pr.base },
    ];
    expect((await f.evaluate()).reuse).toBe(true);
  });

  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/ci.yml@refs/heads/main',
    '.github/workflows/ci.yml@refs/pull/8/merge',
    '.github/workflows/ci.yml@' + workflowSha,
  ])(
    'accepts API-shaped canonical run path %s without treating its qualifier as source proof',
    async (path) => {
      const f = fixture();
      f.state.run.path = path;
      delete f.state.jobs[0].run_attempt;
      expect((await f.evaluate()).reuse).toBe(true);
      expect(f.reader.pages).toHaveBeenCalledWith(
        '/actions/runs/100/attempts/2/jobs',
        'jobs',
      );
      expect(f.reader.get).toHaveBeenCalledWith(
        '/contents/.github/workflows/ci.yml?ref=' + workflowSha,
      );
    },
  );

  it.each([
    '.github/workflows/other.yml@refs/heads/main',
    '.github/workflows/ci.yml@',
    '.github/workflows/ci.yml@@refs/heads/main',
    '.github/workflows/ci.yml@refs/heads/main\n',
    '.github/workflows/ci.yml@refs/heads/main branch',
    '.github/workflows/ci.yml@refs/heads/../main',
    '.github/workflows/ci.yml@refs//heads/main',
    '.github/workflows/ci.yml@refs/heads/main/',
    '.github/workflows/ci.yml@refs/heads/main.',
    '.github/workflows/ci.yml@refs/heads/.main',
    '.github/workflows/ci.yml@refs/heads/main.lock',
    '.github/workflows/ci.yml@refs/heads/main~1',
    '.github/workflows/ci.yml@' + 'x'.repeat(1025),
  ])(
    'rejects a wrong canonical workflow or malformed qualifier %s',
    async (path) => {
      const f = fixture();
      f.state.run.path = path;
      expect((await f.evaluate()).reuse).toBe(false);
    },
  );

  it.each([null, undefined, '2', 0, -1, 1, 2.5])(
    'rejects present malformed or mismatched job attempt %s',
    async (attempt) => {
      const f = fixture();
      f.state.jobs[0].run_attempt = attempt;
      expect((await f.evaluate()).reuse).toBe(false);
    },
  );

  it('verifies a complete decision through the bounded HTTP reader', async () => {
    const f = fixture();
    const transport = vi.fn(async (url) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace('/repos/' + repository, '');
      if (path.endsWith('/pulls') && path.startsWith('/commits/'))
        return Response.json(await f.reader.pages(path));
      if (path.endsWith('/runs') && path.startsWith('/actions/workflows/')) {
        const rows = await f.reader.pages(
          path + '?event=pull_request&head_sha=' + sourceSha,
        );
        return Response.json({ total_count: rows.length, workflow_runs: rows });
      }
      if (path.endsWith('/jobs')) {
        const rows = await f.reader.pages(path, 'jobs');
        return Response.json({ total_count: rows.length, jobs: rows });
      }
      return Response.json(
        await f.reader.get(
          path +
            (path.startsWith('/contents/')
              ? '?ref=' + parsed.searchParams.get('ref')
              : ''),
        ),
      );
    });
    f.options.reader = createGitHubReader({
      repository,
      token: 'fixture-token',
      fetchImpl: transport,
    });
    expect((await f.evaluate()).reuse).toBe(true);
    expect(transport).toHaveBeenCalledTimes(12);
  });

  it.each([
    [
      'PR event',
      (f) => {
        f.options.event = 'pull_request';
      },
    ],
    [
      'non-main ref',
      (f) => {
        f.options.ref = 'refs/heads/staging';
      },
    ],
    [
      'invalid target',
      (f) => {
        f.options.targetSha = 'untrusted';
      },
    ],
    [
      'missing repository ID',
      (f) => {
        f.options.repositoryId = undefined;
      },
    ],
    [
      'different tree including any workflow/test/dependency change',
      (f) => {
        f.state.source.tree.sha = sha('e');
      },
    ],
    [
      'wrong target commit',
      (f) => {
        f.state.target.sha = sourceSha;
      },
    ],
    [
      'wrong source commit',
      (f) => {
        f.state.source.sha = targetSha;
      },
    ],
    [
      'missing PR',
      (f) => {
        f.state.associations = [];
      },
    ],
    [
      'ambiguous merge association',
      (f) => {
        f.state.associations.push({ number: 9, merge_commit_sha: targetSha });
      },
    ],
    [
      'unmerged PR',
      (f) => {
        f.state.pr.merged = false;
      },
    ],
    [
      'wrong merge SHA',
      (f) => {
        f.state.pr.merge_commit_sha = sourceSha;
      },
    ],
    [
      'wrong PR number',
      (f) => {
        f.state.pr.number = 9;
      },
    ],
    [
      'wrong base',
      (f) => {
        f.state.pr.base.ref = 'staging';
      },
    ],
    [
      'fork PR',
      (f) => {
        f.state.pr.head.repo.id = 20;
      },
    ],
    [
      'wrong base repo',
      (f) => {
        f.state.pr.base.repo.full_name = 'other/repo';
      },
    ],
    [
      'missing merge time',
      (f) => {
        f.state.pr.merged_at = null;
      },
    ],
    [
      'future merge',
      (f) => {
        f.state.pr.merged_at = '2099-01-01T00:00:00Z';
      },
    ],
    [
      'wrong workflow path',
      (f) => {
        f.state.workflow.path = '.github/workflows/other.yml';
      },
    ],
    [
      'inactive workflow',
      (f) => {
        f.state.workflow.state = 'disabled_manually';
      },
    ],
    [
      'missing run',
      (f) => {
        f.state.runs = [];
      },
    ],
    [
      'duplicate run',
      (f) => {
        f.state.runs.push(f.state.run);
      },
    ],
    [
      'wrong run event',
      (f) => {
        f.state.run.event = 'push';
      },
    ],
    [
      'forged workflow name with wrong ID',
      (f) => {
        f.state.run.name = 'Foundation CI';
        f.state.run.workflow_id = 51;
      },
    ],
    [
      'wrong run workflow path',
      (f) => {
        f.state.run.path = '.github/workflows/fake.yml';
      },
    ],
    [
      'wrong run head',
      (f) => {
        f.state.run.head_sha = targetSha;
      },
    ],
    [
      'fork run',
      (f) => {
        f.state.run.head_repository.id = 9;
      },
    ],
    [
      'wrong run repository',
      (f) => {
        f.state.run.repository.id = 9;
      },
    ],
    [
      'contradictory optional PR association',
      (f) => {
        f.state.run.pull_requests = [{ number: 9 }];
      },
    ],
    [
      'failed latest run',
      (f) => {
        f.state.run.conclusion = 'failure';
      },
    ],
    [
      'running latest run',
      (f) => {
        f.state.run.status = 'in_progress';
      },
    ],
    [
      'stale validation',
      (f) => {
        f.state.run.run_started_at = '2026-09-30T10:00:00Z';
      },
    ],
    [
      'future validation',
      (f) => {
        f.state.run.updated_at = '2099-01-01T00:00:00Z';
      },
    ],
    [
      'malformed time',
      (f) => {
        f.state.run.run_started_at = 'unknown';
      },
    ],
    [
      'missing required job',
      (f) => {
        f.state.jobs = [];
      },
    ],
    [
      'duplicate required job',
      (f) => {
        f.state.jobs.push(f.state.jobs[0]);
      },
    ],
    [
      'wrong job attempt',
      (f) => {
        f.state.jobs[0].run_attempt = 1;
      },
    ],
    [
      'wrong job head',
      (f) => {
        f.state.jobs[0].head_sha = targetSha;
      },
    ],
    [
      'wrong job run',
      (f) => {
        f.state.jobs[0].run_id = 101;
      },
    ],
    [
      'missing job ID',
      (f) => {
        delete f.state.jobs[0].id;
      },
    ],
    [
      'missing completion time',
      (f) => {
        delete f.state.jobs[0].completed_at;
      },
    ],
    [
      'completion before start',
      (f) => {
        f.state.jobs[0].completed_at = '2026-10-08T09:00:00Z';
      },
    ],
    [
      'completion after run',
      (f) => {
        f.state.jobs[0].completed_at = '2026-10-08T11:30:00Z';
      },
    ],
    [
      'job start before run',
      (f) => {
        f.state.jobs[0].started_at = '2026-10-08T09:00:00Z';
      },
    ],
    [
      'failed job',
      (f) => {
        f.state.jobs[0].conclusion = 'failure';
      },
    ],
    [
      'missing fingerprint',
      (f) => {
        f.state.jobs[0].steps = f.state.jobs[0].steps.filter(
          (s) => !s.name.startsWith(workflowSourceStepPrefix),
        );
      },
    ],
    [
      'skipped fingerprint after unavailable source inspection',
      (f) => {
        f.state.jobs[0].steps.find((s) =>
          s.name.startsWith(workflowSourceStepPrefix),
        ).conclusion = 'skipped';
      },
    ],
    [
      'malformed fingerprint',
      (f) => {
        f.state.jobs[0].steps.find((s) =>
          s.name.startsWith(workflowSourceStepPrefix),
        ).name = workflowSourceStepPrefix + 'untrusted\nvalue';
      },
    ],
    [
      'duplicate fingerprint',
      (f) => {
        f.state.jobs[0].steps.push(
          successfulStep(workflowSourceStepPrefix + workflowSha),
        );
      },
    ],
    [
      'executed workflow differs',
      (f) => {
        f.state.contents.content = Buffer.from('changed\n').toString('base64');
        f.state.contents.size = 8;
      },
    ],
    [
      'truncated workflow content',
      (f) => {
        f.state.contents.size++;
      },
    ],
    [
      'unknown API result',
      (f) => {
        f.reader.get.mockRejectedValue(new Error('private provider details'));
      },
    ],
  ])('falls back to full validation for %s', async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    const result = await f.evaluate();
    expect(result).toEqual({
      reuse: false,
      reasonCode: expect.any(String),
      reason: 'No complete current matching PR validation evidence.',
    });
  });

  it('distinguishes tree changes, missing new gates and unavailable API evidence safely', async () => {
    const tree = fixture();
    tree.state.source.tree.sha = sha('e');
    const marker = fixture();
    marker.state.jobs[0].steps = marker.state.jobs[0].steps.filter(
      (step) => !step.name.startsWith(workflowSourceStepPrefix),
    );
    const api = fixture();
    api.options.reader = createGitHubReader({
      repository,
      token: 'fixture-token',
      fetchImpl: async () =>
        new Response('private-provider-payload', { status: 403 }),
    });
    for (const [f, code] of [
      [tree, 'different-tree'],
      [marker, 'missing-or-duplicate-workflow-source'],
      [api, 'api-unavailable'],
    ]) {
      const result = await f.evaluate();
      expect(result.reasonCode).toBe(code);
      const summary = formatReuseSummary(result, repository);
      expect(summary).toContain(`(${code})`);
      expect(summary).not.toContain('private-provider-payload');
      expect(JSON.stringify(result)).not.toContain('fixture-token');
    }
  });

  it('never exposes an unknown exception or trusts a forged provider reason code', async () => {
    const f = fixture();
    const error = new Error('private exception payload');
    error.code = 'different-tree';
    f.reader.get.mockRejectedValue(error);
    const result = await f.evaluate();
    expect(result.reasonCode).toBe('unknown-error');
    expect(JSON.stringify(result)).not.toContain('private exception payload');
    const summary = formatReuseSummary(
      {
        ...result,
        reasonCode: 'private injected code',
        reason: 'private injected reason',
      },
      repository,
    );
    expect(summary).toContain('(unknown-error)');
    expect(summary).not.toContain('private');
  });

  it.each([
    ...Object.values(foundationStepNames),
    fullCompletionStepName,
    requiredDecisionStepName,
  ])('rejects missing/skipped/failed/duplicate gate %s', async (name) => {
    for (const conclusion of [
      'skipped',
      'failure',
      'cancelled',
      undefined,
      'missing',
      'duplicate',
    ]) {
      const f = fixture();
      const steps = f.state.jobs[0].steps;
      if (conclusion === 'missing')
        f.state.jobs[0].steps = steps.filter((s) => s.name !== name);
      else if (conclusion === 'duplicate') steps.push(successfulStep(name));
      else steps.find((s) => s.name === name).conclusion = conclusion;
      expect((await f.evaluate()).reuse, conclusion).toBe(false);
    }
  });

  it('does not search back to an older successful run after the latest fails', async () => {
    const f = fixture();
    f.state.runs = [
      { ...f.state.run, id: 99 },
      { ...f.state.run, conclusion: 'failure' },
    ];
    f.state.run.conclusion = 'failure';
    expect((await f.evaluate()).reuse).toBe(false);
    expect(f.reader.get).not.toHaveBeenCalledWith('/actions/runs/99');
  });

  it.each(['rerun', 'new run', 'status'])(
    'rejects a %s appearing while jobs are inspected',
    async (kind) => {
      const f = fixture();
      const original = f.reader.pages.getMockImplementation();
      f.reader.pages.mockImplementation(async (...args) => {
        const result = await original(...args);
        if (args[1] === 'jobs') {
          if (kind === 'rerun') f.state.run.run_attempt++;
          if (kind === 'new run')
            f.state.runs.push({ ...f.state.run, id: 101 });
          if (kind === 'status') f.state.run.status = 'queued';
        }
        return result;
      });
      expect((await f.evaluate()).reuse).toBe(false);
    },
  );

  it('rejects drift between the probe and light required job', async () => {
    const f = fixture();
    const evidence = await f.evaluate();
    expect(() =>
      assertSameEvidence(evidence, structuredClone(evidence)),
    ).not.toThrow();
    for (const key of [
      'targetSha',
      'sourceSha',
      'treeSha',
      'prNumber',
      'runId',
      'runAttempt',
      'workflowId',
      'workflowSha',
      'jobId',
      'jobCompletedAt',
      'runCompletedAt',
    ])
      expect(() =>
        assertSameEvidence({ ...evidence, [key]: 'changed' }, evidence),
      ).toThrow('rerun main CI');
    expect(() => assertSameEvidence({ reuse: false }, evidence)).toThrow();
    expect(() => assertSameEvidence(evidence, null)).toThrow();
  });

  it('the full gate fails when the executed workflow differs from checked-out source', async () => {
    const f = fixture();
    await expect(
      verifyWorkflowSource({ reader: f.reader, workflowSha, localWorkflow }),
    ).resolves.toBeUndefined();
    await expect(
      verifyWorkflowSource({
        reader: f.reader,
        workflowSha,
        localWorkflow: 'different',
      }),
    ).rejects.toThrow('workflow-source-mismatch');
  });

  it('rejects a different tested-head workflow even when the reported source matches local bytes', async () => {
    const f = fixture();
    const get = f.reader.get.getMockImplementation();
    f.reader.get.mockImplementation(async (path) => {
      const value = await get(path);
      return path === '/contents/.github/workflows/ci.yml?ref=' + sourceSha
        ? {
            ...value,
            content: Buffer.from('changed\n').toString('base64'),
            size: 8,
          }
        : value;
    });
    expect((await f.evaluate()).reuse).toBe(false);
  });
});

describe('bounded read-only GitHub client', () => {
  const client = (fetchImpl) =>
    createGitHubReader({ repository, token: 'fixture-token', fetchImpl });
  it('uses fixed-origin GET requests, read API headers and rejects redirects', async () => {
    const transport = vi.fn(async () => Response.json({ value: true }));
    expect(await client(transport).get('/actions/workflows/ci.yml')).toEqual({
      value: true,
    });
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/owner/inventory/actions/workflows/ci.yml',
    );
    expect(options.method).toBeUndefined();
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers.Authorization).toBe('Bearer fixture-token');
  });
  it('reads subsequent pages and rejects truncated totals', async () => {
    const transport = vi.fn(async (url) =>
      Response.json(
        new URL(url).searchParams.get('page') === '1'
          ? { total_count: 101, jobs: Array(100).fill({}) }
          : { total_count: 101, jobs: [{}] },
      ),
    );
    expect(
      await client(transport).pages('/actions/runs/1/jobs', 'jobs'),
    ).toHaveLength(101);
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(
      client(async () => Response.json({ total_count: 2, jobs: [{}] })).pages(
        '/jobs',
        'jobs',
      ),
    ).rejects.toThrow('incomplete-page');
  });
  it.each([
    { total_count: 501, jobs: [] },
    { total_count: 0, jobs: {} },
    { total_count: 1.5, jobs: [] },
    { total_count: 101, jobs: Array(101).fill({}) },
  ])('rejects malformed or excessive pagination %j', async (response) => {
    await expect(
      client(async () => Response.json(response)).pages('/jobs', 'jobs'),
    ).rejects.toThrow();
  });
  it.each([
    ['error', async () => new Response('private error', { status: 403 })],
    ['malformed JSON', async () => new Response('{')],
    [
      'oversized body',
      async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    ],
    [
      'network rejection',
      async () => {
        throw new Error('offline');
      },
    ],
  ])('rejects %s', async (_name, transport) => {
    await expect(client(transport).get('/read')).rejects.toThrow();
  });
  it('bounds pages and requests', async () => {
    const c = client(async () => Response.json(Array(100).fill({})));
    await expect(c.pages('/pulls')).rejects.toThrow('page-limit');
    const requests = client(async () => Response.json({}));
    for (let i = 0; i < 45; i++) await requests.get('/read');
    await expect(requests.get('/read')).rejects.toThrow('request-limit');
  });
  it('enforces a shared deadline without retrying or waiting for recovery', async () => {
    const c = createGitHubReader({
      repository,
      token: 'fixture-token',
      timeoutMs: 10,
      fetchImpl: async (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          }),
        ),
    });
    await expect(c.get('/read')).rejects.toThrow();
  });
});

describe('stable required gate fails closed', () => {
  const full = {
    event: 'pull_request',
    ref: 'refs/pull/8/merge',
    pullRequest: { draft: false, state: 'open' },
    probe: 'skipped',
    reuse: '',
    checkout: 'success',
    node: 'success',
    full: 'success',
    recheck: 'skipped',
  };
  it('accepts only complete PR/full-main or verified reuse-main decisions', () => {
    expect(() => assertRequiredValidation(full)).not.toThrow();
    expect(() =>
      assertRequiredValidation({
        ...full,
        event: 'push',
        ref: 'refs/heads/main',
        probe: 'success',
        reuse: 'false',
      }),
    ).not.toThrow();
    expect(() =>
      assertRequiredValidation({
        ...full,
        event: 'push',
        ref: 'refs/heads/main',
        probe: 'success',
        reuse: 'true',
        full: 'skipped',
        recheck: 'success',
      }),
    ).not.toThrow();
  });
  it.each([
    { pullRequest: { draft: true, state: 'open' } },
    { pullRequest: undefined },
    { pullRequest: { draft: 'false', state: 'open' } },
    { pullRequest: { draft: false, state: 'closed' } },
    { pullRequest: { draft: false } },
    { full: 'skipped' },
    { full: 'failure' },
    { checkout: 'failure' },
    { node: 'skipped' },
    { probe: 'failure' },
    { reuse: 'true' },
    { recheck: 'success' },
    { event: 'workflow_dispatch' },
    { event: 'push', ref: 'refs/heads/main', probe: 'failure' },
    { event: 'push', ref: 'refs/heads/main', probe: 'cancelled' },
    {
      event: 'push',
      ref: 'refs/heads/main',
      probe: 'success',
      reuse: 'true',
      recheck: 'failure',
      full: 'skipped',
    },
    {
      event: 'push',
      ref: 'refs/heads/main',
      probe: 'success',
      reuse: 'true',
      recheck: 'success',
    },
  ])('rejects partial or contradictory decision %j', (delta) => {
    expect(() => assertRequiredValidation({ ...full, ...delta })).toThrow();
  });
});
