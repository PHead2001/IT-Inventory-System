export type CommandId =
  | 'overview'
  | 'inventory'
  | 'history'
  | 'maps'
  | 'scan'
  | 'labels'
  | 'add'
  | 'move'
  | 'print'
  | 'help'
  | 'palette';
export type Command = {
  id: CommandId;
  label: string;
  keywords: string;
  shortcut?: string;
  staff?: boolean;
  target:
    | {
        kind: 'navigate';
        href:
          | '/dashboard'
          | '/inventory'
          | '/history'
          | '/room'
          | '/scan'
          | '/labels';
      }
    | { kind: 'overlay'; overlay: 'palette' | 'help' }
    | { kind: 'task'; task: 'add' | 'move' | 'print' };
};
export const commands: readonly Command[] = [
  {
    id: 'palette',
    label: 'Search and commands',
    keywords: 'find equipment',
    shortcut: 'Ctrl/⌘ K',
    target: { kind: 'overlay', overlay: 'palette' },
  },
  {
    id: 'inventory',
    label: 'Search inventory',
    keywords: 'stock find',
    shortcut: '/ · G I',
    target: { kind: 'navigate', href: '/inventory' },
  },
  {
    id: 'overview',
    label: 'Open Overview',
    keywords: 'dashboard home',
    target: { kind: 'navigate', href: '/dashboard' },
  },
  {
    id: 'history',
    label: 'Open History',
    keywords: 'events activity',
    shortcut: 'G H',
    target: { kind: 'navigate', href: '/history' },
  },
  {
    id: 'maps',
    label: 'Open Spaces & maps',
    keywords: 'room closet',
    shortcut: 'G M',
    target: { kind: 'navigate', href: '/room' },
  },
  {
    id: 'scan',
    label: 'Scan equipment',
    keywords: 'camera barcode qr',
    shortcut: 'S',
    target: { kind: 'navigate', href: '/scan' },
  },
  {
    id: 'labels',
    label: 'Open Labels',
    keywords: 'queue print',
    shortcut: 'L',
    target: { kind: 'navigate', href: '/labels' },
  },
  {
    id: 'add',
    label: 'Add item…',
    keywords: 'new individual asset quantity stock',
    shortcut: 'N',
    staff: true,
    target: { kind: 'task', task: 'add' },
  },
  {
    id: 'move',
    label: 'Move asset or stock…',
    keywords: 'relocate transfer',
    staff: true,
    target: { kind: 'task', task: 'move' },
  },
  {
    id: 'print',
    label: 'Print label…',
    keywords: 'queue asset quantity location',
    target: { kind: 'task', task: 'print' },
  },
  {
    id: 'help',
    label: 'Keyboard shortcuts',
    keywords: 'help cheat sheet',
    shortcut: '?',
    target: { kind: 'overlay', overlay: 'help' },
  },
];
export function fuzzyScore(query: string, value: string) {
  const q = query.trim().toLocaleLowerCase();
  const text = value.toLocaleLowerCase();
  if (!q) return 1;
  if (text.includes(q)) return 2 + q.length / Math.max(text.length, 1);
  let cursor = 0;
  for (const letter of text) if (letter === q[cursor]) cursor++;
  if (cursor === q.length) return q.length / Math.max(text.length, 1);
  if (q.length < 3) return 0;
  let best = 0;
  for (const word of text.split(/\s+/)) {
    let previous = Array.from({ length: word.length + 1 }, (_, index) => index);
    for (let i = 1; i <= q.length; i++) {
      const next = [i];
      for (let j = 1; j <= word.length; j++)
        next[j] = Math.min(
          next[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + Number(q[i - 1] !== word[j - 1]),
        );
      previous = next;
    }
    best = Math.max(
      best,
      1 - previous[word.length] / Math.max(q.length, word.length),
    );
  }
  return best >= 0.5 ? best : 0;
}
export function commandMatches(query: string, staff: boolean) {
  return commands
    .filter((entry) => (!entry.staff || staff) && entry.id !== 'palette')
    .map((entry) => ({
      entry,
      score: fuzzyScore(query, entry.label + ' ' + entry.keywords),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .map(({ entry }) => entry);
}
export function ignoresShortcut(event: KeyboardEvent, doc: Document) {
  const target = event.target instanceof Element ? event.target : null;
  return (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    Boolean(
      target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-shortcut-scope="exclusive"], [data-scanner-active="true"], [role="combobox"], [role="menu"], [role="listbox"]',
      ),
    ) ||
    Boolean(
      doc.querySelector(
        '[role="dialog"], [role="alertdialog"], dialog[open], [role="menu"], [role="listbox"], [data-shortcut-scope="exclusive"], [data-scanner-active="true"]',
      ),
    )
  );
}
export function shortcutCommand(
  event: KeyboardEvent,
  prefix: boolean,
): CommandId | 'prefix' | null {
  const key = event.key.toLowerCase();
  if (
    (event.ctrlKey || event.metaKey) &&
    !(event.ctrlKey && event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    key === 'k'
  )
    return 'palette';
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (event.shiftKey && event.key !== '?')
  )
    return null;
  if (prefix)
    return (
      ({ i: 'inventory', h: 'history', m: 'maps' } as const)[
        key as 'i' | 'h' | 'm'
      ] ?? null
    );
  return (
    (
      {
        '/': 'inventory',
        n: 'add',
        s: 'scan',
        l: 'labels',
        '?': 'help',
        g: 'prefix',
      } as const
    )[key as '/' | 'n' | 's' | 'l' | '?' | 'g'] ?? null
  );
}
