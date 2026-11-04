# Pinned postprocessing lifetime patch

This is a narrow patch of the actual shipped `@react-three/postprocessing` 3.1.3
ES module and its affected TypeScript declarations. Upstream:
https://github.com/pmndrs/react-postprocessing, Copyright (c) 2020 react-spring,
MIT license retained in `LICENSE`. The surrounding distribution and unrelated
exports/utilities remain upstream code. These payloads modify EffectComposer and
SelectiveBloom lifecycle ownership; they do not replace the package with an
application composer.

`scripts/patch-postprocessing.mjs`, invoked by the repository postinstall, accepts
only the pinned package version and exact manifest upstream or patched SHA256
bytes. It validates all regions, payloads and complete outputs before writing.
Already-patched files are verified without rewriting; unknown versions or bytes
fail installation. Review and regenerate the manifest for any dependency update.

The optional `ownerCurrent` predicate defaults to a stable true function.
Each committed allocation captures its supplied predicate and an irreversible
retired flag. A new predicate identity creates a new committed composer; old
callbacks never adopt that new owner. Only application-owned composer groups
remount their children per actual resource generation. Selection/default/light
updates, size reads, pass allocation/rebuild, property writes and frames are
guarded; cleanup always restores/releases owned state. Acquired-instance setup
failure rolls back owned passes, buffers and renderer property guards. A constructor
that throws without exposing its internally acquired objects remains responsible
for those inaccessible allocations; this patch makes no contrary guarantee.

SelectiveBloom allocates after commit, recreates after StrictMode/Activity cleanup,
and preserves constructor options, dynamic defaults, selection context and light
layer ownership. Owned ref publications use compare-before-clear tokens.

Prepared runner images use `npm ci --ignore-scripts` to cache verified tarballs,
then delete their temporary project. Actual repository jobs run fresh `npm ci`
and execute this postinstall. No runner execution or permission change is required.
