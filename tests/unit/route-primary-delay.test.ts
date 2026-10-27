import { expect, it } from 'vitest';
import { e2eScheduling, parallelSpecs } from '../../scripts/e2e-scheduling';
import { localPrimaryDelayTarget } from '../e2e/route-primary-delay';

const local = {
  db: 'postgresql://fixture:fixture@127.0.0.1:45322/postgres',
  api: 'http://127.0.0.1:45321',
  hosted: false,
  project: 'chromium',
  workers: 1,
  projectWorkers: 1,
  fullyParallel: false,
  parallelDependsOnExclusive: false,
  projectNames: ['chromium'],
  canonicalConfig: true,
};
it('permits only the canonical local exclusive scheduling and canonical fixture endpoints', () => {
  expect(localPrimaryDelayTarget(local)).toBe(local.db);
  const schedule = e2eScheduling(true);
  const exclusive = schedule.projects.find(
    (project) => project.name === 'chromium-exclusive',
  )!;
  const parallel = schedule.projects.find(
    (project) => project.name === 'chromium-parallel',
  )!;
  expect(new Set<string>(parallelSpecs).has('route-motion.spec.ts')).toBe(
    false,
  );
  expect(exclusive.workers).toBe(1);
  expect(parallel.dependencies).toContain(exclusive.name);
  expect(
    localPrimaryDelayTarget({
      ...local,
      project: exclusive.name,
      workers: schedule.workers,
      projectWorkers: exclusive.workers!,
      parallelDependsOnExclusive: parallel.dependencies!.includes(
        exclusive.name,
      ),
      projectNames: schedule.projects.map((project) => project.name),
    }),
  ).toBe(local.db);
});
it.each([
  { db: 'postgresql://fixture:fixture@127.0.0.1:54322/postgres' },
  { api: 'http://127.0.0.1:54321' },
  { db: 'postgresql://fixture:fixture@remote.example:45322/postgres' },
  { api: 'https://remote.example' },
  { db: 'postgresql://fixture:fixture@127.0.0.1:5432/postgres' },
  { db: 'postgresql://fixture:fixture@127.0.0.1:45322/other' },
  { api: 'http://127.0.0.1:45320' },
  { hosted: true },
  { fullyParallel: true },
  { workers: 2 },
  { projectWorkers: 2 },
  { project: 'chromium-parallel' },
  { project: 'chromium-exclusive', parallelDependsOnExclusive: false },
  { db: undefined },
  { projectNames: ['chromium', 'other'] },
  { canonicalConfig: false },
  {
    db: 'postgresql://fixture:fixture@127.0.0.1:45322/postgres?host=remote.example',
  },
  { db: 'postgresql://fixture:fixture@127.0.0.1:45322/postgres?port=5432' },
  { db: 'postgresql://fixture:fixture@127.0.0.1:45322/postgres#other' },
  { api: 'http://127.0.0.1:45321?host=remote.example' },
])('rejects unsupported target/scheduling before SQL: %s', (change) => {
  expect(() => localPrimaryDelayTarget({ ...local, ...change })).toThrow();
});
