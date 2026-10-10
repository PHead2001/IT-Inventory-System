import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

export function localDockerSocket(
  environment = process.env,
  execute = execFileSync,
) {
  const env = { ...environment };
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  const endpoint = environment.DOCKER_CONTEXT
    ? JSON.parse(
        execute(
          'docker',
          [
            'context',
            'inspect',
            environment.DOCKER_CONTEXT,
            '--format',
            '{{json .Endpoints.docker.Host}}',
          ],
          {
            env,
            encoding: 'utf8',
            timeout: 4_000,
            maxBuffer: 16_384,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      )
    : environment.DOCKER_HOST ||
      JSON.parse(
        execute(
          'docker',
          ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
          {
            env,
            encoding: 'utf8',
            timeout: 4_000,
            maxBuffer: 16_384,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      );
  if (/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(endpoint))
    return endpoint.slice('npipe://'.length).replaceAll('/', '\\');
  const url = new URL(endpoint);
  assert.ok(
    url.protocol === 'unix:' &&
      !url.hostname &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash,
    'Auth fixture requires a local Docker socket',
  );
  return decodeURIComponent(url.pathname);
}
