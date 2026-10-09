import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  foundationStepNames,
  fullCompletionStepName,
  requiredDecisionStepName,
  workflowSourceStepPrefix,
} from './ci-gates.mjs';

const workflowPath = '.github/workflows/ci.yml';
const shaPattern = /^[a-f0-9]{40}$/;
const maxAge = 7 * 24 * 60 * 60 * 1000;
const maxBytes = 2 * 1024 * 1024;
const fallbackReasons = Object.freeze({
  'unavailable-context': 'The read-only GitHub context is unavailable.',
  'request-limit': 'The evidence lookup exceeded its request bound.',
  'invalid-path': 'The evidence lookup path was invalid.',
  'api-unavailable':
    'The GitHub API was unavailable or denied the evidence lookup.',
  'invalid-response': 'GitHub returned an incomplete or invalid response.',
  'response-limit': 'The evidence response exceeded its size bound.',
  'invalid-page': 'GitHub returned an invalid evidence page.',
  'incomplete-page':
    'The evidence inventory was incomplete or exceeded its bound.',
  'page-limit': 'The evidence inventory exceeded its page bound.',
  'invalid-workflow-source':
    'The workflow source evidence was missing or malformed.',
  'workflow-source-mismatch':
    'The executed and tested workflow sources differ.',
  'repository-mismatch': 'The evidence belongs to a different repository.',
  'run-identity-mismatch':
    'The source run identity does not match the canonical workflow and head.',
  'run-pr-mismatch': 'The source run contradicts the merged PR association.',
  'run-not-current-success':
    'The latest source run is unsuccessful, incomplete or older than seven days.',
  'missing-run': 'No matching source PR run was available.',
  'duplicate-run': 'The source run inventory contained duplicate identities.',
  'missing-or-duplicate-required-job':
    'A unique source required job was unavailable.',
  'required-job-not-successful':
    'The source required job lacks complete successful attempt evidence.',
  'missing-or-duplicate-workflow-source':
    'The source run lacks the unique workflow-source eligibility marker.',
  'incomplete-full-gate':
    'The source run lacks a complete successful set of named full gates.',
  'ineligible-context': 'This event is ineligible for main validation reuse.',
  'workflow-identity-mismatch':
    'The canonical workflow identity is unavailable or inactive.',
  'invalid-target-tree': 'The target commit tree could not be verified.',
  'missing-or-ambiguous-merge':
    'A unique merged PR association could not be verified.',
  'pr-not-merged-main':
    'The associated PR is not a verified merge into main at this target.',
  'different-tree':
    'The merged main tree differs from the tested PR head tree.',
  'run-changed':
    'The latest source run or attempt changed during verification.',
  'unknown-error':
    'No complete current matching PR validation evidence was available.',
});
class EvidenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const requireEvidence = (condition, reason) => {
  if (!condition) throw new EvidenceError(reason);
};
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export function createGitHubReader({
  repository,
  token,
  fetchImpl = fetch,
  timeoutMs = 45_000,
}) {
  requireEvidence(
    /^[\w.-]+\/[\w.-]+$/.test(repository) && typeof token === 'string' && token,
    'unavailable-context',
  );
  const signal = AbortSignal.timeout(timeoutMs);
  let requests = 0;
  async function get(path) {
    requireEvidence(++requests <= 45, 'request-limit');
    requireEvidence(
      path.startsWith('/') && !path.includes('..'),
      'invalid-path',
    );
    let response;
    try {
      response = await fetchImpl(
        `https://api.github.com/repos/${repository}${path}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          redirect: 'error',
          signal,
        },
      );
    } catch {
      throw new EvidenceError('api-unavailable');
    }
    requireEvidence(response.ok, 'api-unavailable');
    requireEvidence(response.body, 'invalid-response');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        requireEvidence(size <= maxBytes, 'response-limit');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new EvidenceError('invalid-response');
    }
  }
  async function pages(path, key) {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const data = await get(
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      );
      const rows = key ? data[key] : data;
      requireEvidence(
        Array.isArray(rows) && rows.length <= 100,
        'invalid-page',
      );
      if (key)
        requireEvidence(
          Number.isSafeInteger(data.total_count) &&
            data.total_count >= rows.length &&
            data.total_count <= 500,
          'incomplete-page',
        );
      all.push(...rows);
      if (rows.length < 100) {
        if (key)
          requireEvidence(all.length === data.total_count, 'incomplete-page');
        return all;
      }
    }
    throw new EvidenceError('page-limit');
  }
  return { get, pages };
}

async function workflowBytes(reader, sha) {
  requireEvidence(shaPattern.test(sha), 'invalid-workflow-source');
  const file = await reader.get(`/contents/${workflowPath}?ref=${sha}`);
  requireEvidence(
    file.type === 'file' &&
      file.path === workflowPath &&
      file.encoding === 'base64' &&
      Number.isSafeInteger(file.size) &&
      file.size > 0 &&
      file.size <= maxBytes &&
      typeof file.content === 'string' &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(file.content),
    'invalid-workflow-source',
  );
  const bytes = Buffer.from(file.content, 'base64');
  requireEvidence(bytes.length === file.size, 'invalid-workflow-source');
  return bytes;
}

export async function verifyWorkflowSource({
  reader,
  workflowSha,
  localWorkflow,
}) {
  const executed = await workflowBytes(reader, workflowSha);
  requireEvidence(
    executed.equals(Buffer.from(localWorkflow)),
    'workflow-source-mismatch',
  );
}

function assertRepository(actual, repository, repositoryId) {
  requireEvidence(
    actual?.full_name === repository && actual?.id === repositoryId,
    'repository-mismatch',
  );
}

function isCanonicalRunPath(path) {
  if (path === workflowPath) return true;
  if (typeof path !== 'string' || !path.startsWith(workflowPath + '@'))
    return false;
  // GitHub may qualify this path with a ref. It is only a bounded path hint;
  // the observed source marker and independent workflow blob checks prove source.
  const ref = path.slice(workflowPath.length + 1);
  return (
    ref.length <= 1024 &&
    /^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(ref) &&
    !ref.includes('..') &&
    !ref.includes('//') &&
    !ref.endsWith('/') &&
    !ref.endsWith('.') &&
    ref
      .split('/')
      .every((part) => !part.startsWith('.') && !part.endsWith('.lock'))
  );
}

function assertRun(run, context) {
  requireEvidence(
    positiveInteger(run.id) &&
      positiveInteger(run.run_attempt) &&
      run.workflow_id === context.workflowId &&
      isCanonicalRunPath(run.path) &&
      run.event === 'pull_request' &&
      run.head_sha === context.sourceSha,
    'run-identity-mismatch',
  );
  assertRepository(run.repository, context.repository, context.repositoryId);
  assertRepository(
    run.head_repository,
    context.repository,
    context.repositoryId,
  );
  requireEvidence(
    Array.isArray(run.pull_requests) &&
      (run.pull_requests.length === 0 ||
        run.pull_requests.every(
          (pr) =>
            pr.number === context.prNumber &&
            pr.head?.sha === context.sourceSha &&
            pr.head?.repo?.id === context.repositoryId &&
            pr.base?.ref === 'main' &&
            pr.base?.repo?.id === context.repositoryId,
        )),
    'run-pr-mismatch',
  );
}

function assertSuccessfulRun(run, now) {
  const started = Date.parse(run.run_started_at);
  const updated = Date.parse(run.updated_at);
  requireEvidence(
    run.status === 'completed' &&
      run.conclusion === 'success' &&
      Number.isFinite(started) &&
      Number.isFinite(updated) &&
      started >= now - maxAge &&
      started <= now &&
      updated >= started &&
      updated <= now,
    'run-not-current-success',
  );
}

async function latestRun(reader, context) {
  const runs = await reader.pages(
    `/actions/workflows/${context.workflowId}/runs?event=pull_request&head_sha=${context.sourceSha}`,
    'workflow_runs',
  );
  requireEvidence(runs.length > 0, 'missing-run');
  // Every result is already scoped by the provider to this workflow/head/event.
  // Malformed rows and association gaps are unknown evidence, not older-run hints.
  for (const run of runs) assertRun(run, context);
  requireEvidence(
    new Set(runs.map((run) => run.id)).size === runs.length,
    'duplicate-run',
  );
  return runs.reduce((latest, run) => (run.id > latest.id ? run : latest));
}

function fullJobEvidence(jobs, run, sourceSha, now) {
  const required = jobs.filter((job) => job.name === 'required');
  requireEvidence(required.length === 1, 'missing-or-duplicate-required-job');
  const job = required[0];
  const started = Date.parse(job.started_at);
  const completed = Date.parse(job.completed_at);
  requireEvidence(
    positiveInteger(job.id) &&
      job.run_id === run.id &&
      // The jobs request is scoped to the exact run/attempt URL. Some API
      // payloads omit run_attempt; an explicitly returned value must agree.
      (!Object.hasOwn(job, 'run_attempt') ||
        job.run_attempt === run.run_attempt) &&
      job.head_sha === sourceSha &&
      job.status === 'completed' &&
      job.conclusion === 'success' &&
      Number.isFinite(started) &&
      Number.isFinite(completed) &&
      started >= Date.parse(run.run_started_at) &&
      completed >= started &&
      completed >= now - maxAge &&
      completed <= Date.parse(run.updated_at) &&
      Array.isArray(job.steps),
    'required-job-not-successful',
  );
  const fingerprints = job.steps.filter((step) =>
    step.name?.startsWith(workflowSourceStepPrefix),
  );
  requireEvidence(
    fingerprints.length === 1,
    'missing-or-duplicate-workflow-source',
  );
  const fingerprint = fingerprints[0];
  const workflowSha = fingerprint.name.slice(workflowSourceStepPrefix.length);
  requireEvidence(shaPattern.test(workflowSha), 'invalid-workflow-source');
  const names = [
    ...Object.values(foundationStepNames),
    fingerprint.name,
    fullCompletionStepName,
    requiredDecisionStepName,
  ];
  for (const name of names) {
    const matches = job.steps.filter((step) => step.name === name);
    requireEvidence(
      matches.length === 1 &&
        matches[0].status === 'completed' &&
        matches[0].conclusion === 'success',
      'incomplete-full-gate',
    );
  }
  return { workflowSha, jobId: job.id, jobCompletedAt: job.completed_at };
}

export async function findReusableValidation({
  repository,
  repositoryId,
  targetSha,
  event,
  ref,
  localWorkflow,
  reader,
  now = Date.now(),
}) {
  try {
    requireEvidence(
      event === 'push' &&
        ref === 'refs/heads/main' &&
        shaPattern.test(targetSha) &&
        positiveInteger(repositoryId) &&
        /^[\w.-]+\/[\w.-]+$/.test(repository) &&
        Number.isFinite(now),
      'ineligible-context',
    );
    const workflow = await reader.get('/actions/workflows/ci.yml');
    requireEvidence(
      positiveInteger(workflow.id) &&
        workflow.path === workflowPath &&
        workflow.state === 'active',
      'workflow-identity-mismatch',
    );
    const target = await reader.get(`/git/commits/${targetSha}`);
    requireEvidence(
      target.sha === targetSha && shaPattern.test(target.tree?.sha),
      'invalid-target-tree',
    );
    const prs = await reader.pages(`/commits/${targetSha}/pulls`);
    const candidates = prs.filter((pr) => pr.merge_commit_sha === targetSha);
    requireEvidence(
      candidates.length === 1 && positiveInteger(candidates[0].number),
      'missing-or-ambiguous-merge',
    );
    const pr = await reader.get(`/pulls/${candidates[0].number}`);
    requireEvidence(
      pr.number === candidates[0].number &&
        pr.merged === true &&
        pr.state === 'closed' &&
        pr.merge_commit_sha === targetSha &&
        pr.base?.ref === 'main' &&
        shaPattern.test(pr.head?.sha) &&
        Number.isFinite(Date.parse(pr.merged_at)) &&
        Date.parse(pr.merged_at) <= now,
      'pr-not-merged-main',
    );
    assertRepository(pr.base.repo, repository, repositoryId);
    assertRepository(pr.head.repo, repository, repositoryId);
    const source = await reader.get(`/git/commits/${pr.head.sha}`);
    requireEvidence(
      source.sha === pr.head.sha && source.tree?.sha === target.tree.sha,
      'different-tree',
    );
    const context = {
      repository,
      repositoryId,
      workflowId: workflow.id,
      sourceSha: source.sha,
      prNumber: pr.number,
    };
    const listed = await latestRun(reader, context);
    const run = await reader.get(`/actions/runs/${listed.id}`);
    assertRun(run, context);
    requireEvidence(
      run.id === listed.id && run.run_attempt === listed.run_attempt,
      'run-changed',
    );
    assertSuccessfulRun(run, now);
    const jobs = await reader.pages(
      `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      'jobs',
    );
    const { workflowSha, jobId, jobCompletedAt } = fullJobEvidence(
      jobs,
      run,
      source.sha,
      now,
    );
    await verifyWorkflowSource({ reader, workflowSha, localWorkflow });
    const testedWorkflow = await workflowBytes(reader, source.sha);
    requireEvidence(
      testedWorkflow.equals(Buffer.from(localWorkflow)),
      'workflow-source-mismatch',
    );
    // Re-read both the selected run and the latest-run inventory after inspecting
    // attempt-specific jobs. A rerun/newer run cannot inherit an old green result.
    const fresh = await reader.get(`/actions/runs/${run.id}`);
    assertRun(fresh, context);
    assertSuccessfulRun(fresh, now);
    const latest = await latestRun(reader, context);
    requireEvidence(
      fresh.run_attempt === run.run_attempt &&
        fresh.updated_at === run.updated_at &&
        latest.id === run.id &&
        latest.run_attempt === run.run_attempt &&
        latest.status === 'completed' &&
        latest.conclusion === 'success',
      'run-changed',
    );
    return {
      reuse: true,
      targetSha,
      sourceSha: source.sha,
      treeSha: target.tree.sha,
      prNumber: pr.number,
      runId: run.id,
      runAttempt: run.run_attempt,
      workflowId: workflow.id,
      workflowSha,
      jobId,
      jobCompletedAt,
      runCompletedAt: run.updated_at,
    };
  } catch (error) {
    // No provider response/error text is propagated: it may contain private data.
    const reasonCode =
      error instanceof EvidenceError &&
      Object.hasOwn(fallbackReasons, error.code)
        ? error.code
        : 'unknown-error';
    return {
      reuse: false,
      reasonCode,
      reason: 'No complete current matching PR validation evidence.',
    };
  }
}

export function assertSameEvidence(actual, expected) {
  requireEvidence(
    actual.reuse === true &&
      expected?.reuse === true &&
      [
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
      ].every((key) => actual[key] === expected[key]),
    'Reused validation changed; rerun main CI for full validation.',
  );
}

export function formatReuseSummary(result, repository) {
  if (!result.reuse) {
    const reasonCode = Object.hasOwn(fallbackReasons, result.reasonCode)
      ? result.reasonCode
      : 'unknown-error';
    return `Full foundation validation required (${reasonCode}): ${fallbackReasons[reasonCode]}\n`;
  }
  return (
    `Reusing full PR validation for main [${result.targetSha}](https://github.com/${repository}/commit/${result.targetSha}).\n\n` +
    `PR #${result.prNumber}; source head \`${result.sourceSha}\`; identical whole Git tree \`${result.treeSha}\`.\n\n` +
    `Source [Foundation CI run ${result.runId}, attempt ${result.runAttempt}](https://github.com/${repository}/actions/runs/${result.runId}/attempts/${result.runAttempt}), workflow ID ${result.workflowId}; workflow-reported revision \`${result.workflowSha}\`.\n\n` +
    `Full [required job ${result.jobId}](https://github.com/${repository}/actions/runs/${result.runId}/job/${result.jobId}) completed ${result.jobCompletedAt}; run completion/update ${result.runCompletedAt}.\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    const reader = createGitHubReader({
      repository,
      token: process.env.GH_TOKEN,
    });
    const localWorkflow = readFileSync(workflowPath);
    if (process.argv.includes('--workflow-source')) {
      await verifyWorkflowSource({
        reader,
        workflowSha: process.env.GITHUB_WORKFLOW_SHA,
        localWorkflow,
      });
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, 'verified=true\n');
      console.log('Executed workflow matches the tested workflow.');
    } else {
      const result = await findReusableValidation({
        repository,
        repositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
        targetSha: process.env.GITHUB_SHA,
        event: process.env.GITHUB_EVENT_NAME,
        ref: process.env.GITHUB_REF,
        localWorkflow,
        reader,
      });
      if (process.argv.includes('--reverify'))
        assertSameEvidence(
          result,
          JSON.parse(process.env.REUSE_EVIDENCE ?? 'null'),
        );
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `reuse=${result.reuse}\nevidence=${JSON.stringify(result)}\n`,
        );
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          formatReuseSummary(result, repository),
        );
      console.log(
        result.reuse
          ? 'Matching full PR validation verified.'
          : 'Full validation required.',
      );
    }
  } catch {
    console.error('Validation evidence could not be verified.');
    process.exitCode = 1;
  }
}
