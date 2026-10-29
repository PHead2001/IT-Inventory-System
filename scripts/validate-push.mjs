import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { npm } from './runtime.mjs';

// Preserve quoted NODE_OPTIONS values without interpreting them as shell code.
function nodeOptionTokens(value) {
  const tokens = [];
  let start = -1;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (start === -1 && /\s/.test(char)) continue;
    if (start === -1) start = index;
    if (char === '\\' && quoted) index += 1;
    else if (char === '"') quoted = !quoted;
    else if (/\s/.test(char) && !quoted) {
      tokens.push(value.slice(start, index));
      start = -1;
    }
  }
  if (quoted) throw new Error('NODE_OPTIONS contains an unclosed quote.');
  if (start !== -1) tokens.push(value.slice(start));
  return tokens;
}

export function pushNodeOptions(value = '', heapMiB = 1024) {
  if (![1024, 2048].includes(heapMiB))
    throw new Error('Unsupported local push heap budget.');
  const tokens = nodeOptionTokens(value);
  const retained = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].replaceAll('"', '');
    // Percentage limits can override the absolute cap; remove those as well.
    if (
      /^--max[-_]old[-_]space[-_]size(?:[-_]percentage)?(?:=|$)/.test(token)
    ) {
      if (!token.includes('=')) {
        if (
          !/^\d+(?:\.\d+)?$/.test(tokens[index + 1]?.replaceAll('"', '') ?? '')
        )
          throw new Error('NODE_OPTIONS contains an incomplete heap limit.');
        index += 1;
      }
    } else retained.push(tokens[index]);
  }
  return [...retained, `--max-old-space-size=${heapMiB}`].join(' ');
}

export function runPushValidation({ env = process.env, run = npm } = {}) {
  for (const args of [
    ['run', 'typecheck'],
    ['run', 'lint'],
    ['run', 'format:check'],
    ['run', 'test', '--', '--maxWorkers=1', '--no-file-parallelism'],
  ]) {
    const heapMiB = args[1] === 'typecheck' ? 2048 : 1024;
    run(args, {
      env: { ...env, NODE_OPTIONS: pushNodeOptions(env.NODE_OPTIONS, heapMiB) },
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    runPushValidation();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
