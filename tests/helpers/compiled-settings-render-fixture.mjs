import { createElement } from 'react';
import { renderToReadableStream } from 'next/dist/compiled/react-server-dom-turbopack/server.node.js';
import { BuildInfo } from '../../src/features/build-info/build-info.tsx';

// Only synthetic public provenance leaves this process. Parent overhead makes
// the installed production renderer outline children within the BuildInfo tree.
const provenance = {
  environment: 'Local',
  version: '0.1.0',
  commit: 'a'.repeat(40),
  buildStarted: '2026-10-11T12:00:00.000Z',
};
const stream = await renderToReadableStream(
  createElement(
    'main',
    null,
    ...Array.from({ length: 25 }, (_, index) =>
      createElement('span', { key: index }, 'x'.repeat(80)),
    ),
    createElement(BuildInfo, { provenance }),
  ),
  {},
);
process.stdout.write(await new Response(stream).text());
