import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const repository = 'PHead2001/IT-Inventory-System';
const api = `https://api.github.com/repos/${repository}`;

export function selectOpenSameRepositoryPrs(pulls) {
  if (!Array.isArray(pulls) || pulls.length >= 100)
    throw new Error('PR list is invalid or exceeds the bounded page');
  return pulls
    .filter(
      (pr) =>
        Number.isSafeInteger(pr.number) &&
        pr.number > 0 &&
        pr.state === 'open' &&
        pr.head?.repo?.full_name === repository &&
        pr.base?.repo?.full_name === repository,
    )
    .map((pr) => pr.number);
}

async function main() {
  if (
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_REPOSITORY !== repository ||
    !process.env.GITHUB_TOKEN ||
    !process.env.GITHUB_EVENT_PATH ||
    !process.env.GITHUB_OUTPUT
  )
    throw new Error('Discovery environment is incomplete');
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const fetchGithub = async (path) => {
    const response = await fetch(`${api}${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('GitHub PR discovery failed');
    return response.json();
  };
  let pulls;
  if (process.env.GITHUB_EVENT_NAME === 'schedule') {
    pulls = await fetchGithub('/pulls?state=open&per_page=100');
  } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const number = Number(event.inputs?.pr_number);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error('PR number is invalid');
    pulls = [await fetchGithub(`/pulls/${number}`)];
  } else if (process.env.GITHUB_EVENT_NAME === 'pull_request_target') {
    const number = event.number;
    if (!Number.isSafeInteger(number) || number < 1)
      throw new Error('PR number is invalid');
    pulls = [await fetchGithub(`/pulls/${number}`)];
  } else throw new Error('Event is unsupported');
  const numbers = selectOpenSameRepositoryPrs(pulls);
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `targets=${JSON.stringify(numbers)}\ncount=${numbers.length}\n`,
  );
  process.stdout.write(`Discovered ${numbers.length} eligible preview PRs\n`);
}

// Importing the selector in Node tests must not start a workflow run.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main().catch(() => {
    process.stderr.write('Preview PR discovery failed: DISCOVERY_ERROR\n');
    process.exitCode = 1;
  });
}
