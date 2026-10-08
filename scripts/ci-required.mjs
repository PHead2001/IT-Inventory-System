import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertRequiredValidation({
  event,
  ref,
  probe,
  reuse,
  checkout,
  node,
  full,
  recheck,
}) {
  if (checkout !== 'success' || node !== 'success')
    throw new Error('Required validation setup did not succeed.');
  const main = event === 'push' && ref === 'refs/heads/main';
  if (!main && event !== 'pull_request')
    throw new Error('Unsupported validation context.');
  if (main && probe !== 'success')
    throw new Error('Main evidence job did not complete successfully.');
  if (event === 'pull_request' && (probe !== 'skipped' || reuse === 'true'))
    throw new Error('Pull requests require fresh full validation.');
  if (main && reuse === 'true') {
    if (recheck !== 'success' || full !== 'skipped')
      throw new Error('Reused validation was not freshly verified.');
  } else if (full !== 'success' || recheck !== 'skipped') {
    throw new Error('Full validation did not complete successfully.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    assertRequiredValidation({
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      probe: process.env.EVIDENCE_RESULT,
      reuse: process.env.REUSE,
      checkout: process.env.CHECKOUT_RESULT,
      node: process.env.NODE_RESULT,
      full: process.env.FULL_RESULT,
      recheck: process.env.RECHECK_RESULT,
    });
    console.log('Required validation decision passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
