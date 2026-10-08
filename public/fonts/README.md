# Local fonts

Pinned upstream assets, self-hosted through next/font/local. No build-time font network request.

- `inter-latin-v5.2.8.woff2`: Latin normal variable subset from pinned @fontsource-variable/inter 5.2.8, https://registry.npmjs.org/@fontsource-variable/inter/-/inter-5.2.8.tgz (package/files/inter-latin-wght-normal.woff2). Upstream Inter 4.1: https://github.com/rsms/inter/tree/v4.1
- `Inter-OFL.txt`: https://raw.githubusercontent.com/rsms/inter/v4.1/LICENSE.txt
- `jetbrains-mono-v2.304-regular.woff2`: https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/webfonts/JetBrainsMono-Regular.woff2
- `JetBrainsMono-OFL.txt`: https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/OFL.txt

Inter 4.1 supplies normal variable weights 100-900. JetBrains Mono 2.304 supplies normal 400. Original upstream OFL licenses accompany both. Inter uses the Latin subset; other Unicode characters use system sans fallback. JetBrains Mono retains upstream Unicode coverage with system mono fallback. No italic or duplicate weight files are included.
