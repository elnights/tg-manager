import type {Key} from 'ink';

export type Shortcut = {key: string; label: string; compactLabel?: string};
export type FooterState = {
  focus: 'chats' | 'messages' | 'discussion';
  busy: boolean;
  cancelling: boolean;
  confirm: boolean;
  canConfirm: boolean;
  selectPrompt: boolean;
  hasChat: boolean;
  canNavigate: boolean;
  canSelect: boolean;
  hasOwn: boolean;
  selected: number;
  hasMore: boolean;
  includePrivate: boolean;
  searching?: boolean;
  initialError?: boolean;
  chatsMore?: boolean;
  canInspect?: boolean;
  hasDiscussion?: boolean;
  backgroundLoading?: boolean;
  canScan?: boolean;
  canGoToPost?: boolean;
  hasNotice?: boolean;
  promptVisible?: boolean;
  confirmationText?: string;
};
type Group =
  | 'Navigation'
  | 'Chat management'
  | 'Message selection'
  | 'Loading and pagination'
  | 'Deletion'
  | 'Layout and settings';
type Command = Shortcut & {
  id: string;
  hint?: 'view' | 'help';
  group: Group;
  description: string;
  reference?: string;
  chars?: string[];
  keys?: (keyof Key)[];
  available: (state: FooterState) => boolean;
};
const messages = (state: FooterState) => state.focus !== 'chats';
export const commands: Command[] = [
  {
    id: 'up',
    key: '↑↓/jk',
    label: 'Navigate',
    compactLabel: 'Move',
    group: 'Navigation',
    description: 'Move in the focused panel',
    chars: ['j', 'k'],
    keys: ['upArrow', 'downArrow'],
    available: (state) => state.canNavigate,
  },
  {
    id: 'page',
    hint: 'help',
    key: 'PgUp/PgDn',
    label: 'Page',
    group: 'Navigation',
    description: 'Move by the visible list height',
    keys: ['pageUp', 'pageDown'],
    available: (state) => state.canNavigate,
  },
  {
    id: 'ends',
    hint: 'help',
    key: 'Home/End',
    label: 'Ends',
    group: 'Navigation',
    description: 'First / last loaded item in either list',
    keys: ['home', 'end'],
    available: (state) => state.canNavigate,
  },
  {
    id: 'focus',
    key: 'Tab/←→',
    label: 'Switch panel',
    compactLabel: 'Panel',
    group: 'Navigation',
    description: 'Cycle panels; Shift+Tab / left arrow reverses',
    keys: ['tab', 'leftArrow', 'rightArrow'],
    available: () => true,
  },
  {
    id: 'private',
    key: 'p',
    label: 'Private + bots',
    compactLabel: 'P+B',
    group: 'Chat management',
    description: 'Include or hide private chats and bots together; f filters each type separately',
    chars: ['p'],
    available: () => true,
  },
  {
    id: 'types',
    hint: 'view',
    key: 'f',
    label: 'Chat types',
    group: 'Chat management',
    description:
      'Choose any combination of private chats, bots, basic groups, supergroups and channels; Space toggles, Enter applies, Esc cancels',
    chars: ['f'],
    available: () => true,
  },
  {
    id: 'ownChats',
    hint: 'view',
    key: 'o',
    label: 'With my messages',
    group: 'Chat management',
    description:
      'Find loaded chats and linked discussions containing your own messages; Esc stops checks. New chat pages are checked too.',
    chars: ['o'],
    available: () => true,
  },
  {
    id: 'search',
    key: '/',
    label: 'Search chats',
    compactLabel: 'Search',
    group: 'Chat management',
    description: 'Edit a visible query over loaded chats; Enter apply, Esc restore',
    chars: ['/'],
    available: () => true,
  },
  {
    id: 'chats',
    key: 'R',
    label: 'Reload chats',
    compactLabel: 'Chats',
    group: 'Chat management',
    description: 'Refresh the chat list; preserve active chat by ID',
    chars: ['R'],
    available: () => true,
  },
  {
    id: 'moreChats',
    key: 'm',
    label: 'More chats',
    compactLabel: 'More',
    group: 'Chat management',
    description: 'Load another 100 dialogs; search remains local',
    chars: ['m'],
    available: (state) => Boolean(state.chatsMore),
  },
  {
    id: 'discussion',
    key: 't',
    label: 'Discussion scope',
    compactLabel: 'Scope',
    group: 'Chat management',
    description: 'Discussion scope: entire linked group / highlighted channel post',
    chars: ['t'],
    available: (state) => Boolean(state.hasDiscussion),
  },
  {
    id: 'sourcePost',
    key: 'g',
    label: 'Go to post',
    compactLabel: 'Post',
    group: 'Navigation',
    description:
      'Focus the current comment’s source channel post; load its page and show All posts when needed',
    chars: ['g'],
    available: (state) => state.focus === 'discussion' && Boolean(state.canGoToPost),
  },
  {
    id: 'detail',
    key: 'Enter',
    label: 'Inspect',
    group: 'Navigation',
    description: 'Read-only message detail; arrows/pages/Home/End scroll, Esc/Enter close',
    keys: ['return'],
    available: (state) => messages(state) && Boolean(state.canInspect),
  },
  {
    id: 'view',
    hint: 'view',
    key: 'v',
    label: 'Mine/All',
    compactLabel: 'View',
    group: 'Chat management',
    description: 'Mine / All authors in the focused message pane; clear its selection',
    chars: ['v'],
    available: () => true,
  },
  {
    id: 'reload',
    key: 'r',
    label: 'Reload',
    group: 'Chat management',
    description: 'Reload active messages, or retry failed initialization',
    chars: ['r'],
    available: (state) => state.hasChat || Boolean(state.initialError),
  },
  {
    id: 'mark',
    key: 'Space',
    label: 'Select',
    compactLabel: 'Mark',
    group: 'Message selection',
    description: 'Toggle own message (messages panel)',
    chars: [' '],
    available: (state) => messages(state) && state.canSelect,
  },
  {
    id: 'select',
    key: 's',
    label: 'Select all',
    group: 'Message selection',
    description: 'Select all your messages in the current view; offer to load remaining history',
    chars: ['s'],
    available: (state) => messages(state) && (state.hasOwn || state.hasMore),
  },
  {
    id: 'clear',
    key: 'c',
    label: 'Clear selection',
    compactLabel: 'Clear',
    group: 'Message selection',
    description: 'Clear selection from either panel',
    chars: ['c'],
    available: (state) => Boolean(state.selected),
  },
  {
    id: 'delete',
    key: 'd',
    label: 'Delete selected',
    compactLabel: 'Delete',
    group: 'Deletion',
    description: 'Confirm deletion of selected own messages',
    chars: ['d'],
    available: (state) => messages(state) && Boolean(state.selected),
  },
  {
    id: 'scan',
    key: 'A',
    reference: 'A (Shift+a)',
    label: 'Delete all own',
    compactLabel: 'Delete all',
    group: 'Deletion',
    description: 'Scan ALL own messages, then ask to delete',
    chars: ['A'],
    available: (state) => state.hasChat && state.canScan !== false,
  },
  {
    id: 'next',
    key: 'n',
    label: 'Next page',
    compactLabel: 'Next',
    group: 'Loading and pagination',
    description: 'Next page of 100 (messages panel)',
    chars: ['n'],
    available: (state) => messages(state) && state.hasMore && state.hasChat,
  },
  {
    id: 'load',
    key: 'L',
    reference: 'L (Shift+l)',
    label: 'Load all',
    group: 'Loading and pagination',
    description: 'Load remaining view (messages panel)',
    chars: ['L'],
    available: (state) => messages(state) && state.hasMore && state.hasChat,
  },
  {
    id: 'split',
    hint: 'help',
    key: '{ }',
    label: 'Split height',
    group: 'Layout and settings',
    description: 'Reduce / increase the posts pane height; 0 resets the layout',
    chars: ['{', '}'],
    available: (state) => Boolean(state.hasDiscussion),
  },
  {
    id: 'width',
    hint: 'help',
    key: '[ ]',
    reference: '[ / ]',
    label: 'Resize',
    group: 'Layout and settings',
    description: 'Narrow / widen chat panel; saved automatically',
    chars: ['[', ']'],
    available: () => true,
  },
  {
    id: 'reset',
    hint: 'help',
    key: '0',
    label: 'Reset width',
    compactLabel: 'Reset',
    group: 'Layout and settings',
    description: 'Reset chat width to 32% and posts/discussion split to 50%',
    chars: ['0'],
    available: () => true,
  },
  {
    id: 'quit',
    key: 'q/Ctrl+C',
    reference: 'q',
    label: 'Quit',
    group: 'Navigation',
    description: 'Quit from the idle main view',
    chars: ['q'],
    available: () => true,
  },
  {
    id: 'stopDiscussion',
    key: 'Esc',
    label: 'Stop background load',
    compactLabel: 'Stop',
    group: 'Loading and pagination',
    description: 'Stop automatic discussion or source-post loading after the in-flight request',
    keys: ['escape'],
    available: (state) => Boolean(state.backgroundLoading),
  },
  {
    id: 'dismiss',
    key: 'Esc',
    label: 'Dismiss',
    group: 'Navigation',
    description: 'Dismiss an idle notice',
    keys: ['escape'],
    available: (state) => Boolean(state.hasNotice) && !state.backgroundLoading,
  },
  {
    id: 'notice',
    key: '!',
    label: 'Details',
    group: 'Navigation',
    description: 'Read and scroll the complete notice',
    chars: ['!'],
    available: (state) => Boolean(state.hasNotice),
  },
  {
    id: 'help',
    key: '?',
    label: 'Help',
    group: 'Layout and settings',
    description: 'Open keyboard help; preserve any prompt',
    chars: ['?'],
    available: () => true,
  },
];
type Binding = Shortcut & {
  id: string;
  chars?: string[];
  keys?: (keyof Key)[];
  pattern?: RegExp;
  available?: (state: FooterState) => boolean;
};
const helpBinding: Binding = {id: 'help', key: '?', label: 'Help', chars: ['?']};
const interrupt: Binding = {id: 'interrupt', key: 'Ctrl+C', label: 'Quit'};
const visible = (state: FooterState) => state.promptVisible !== false;
const modalBindings: Record<'search' | 'confirm' | 'select' | 'busy', Binding[]> = {
  search: [
    {id: 'searchEdit', key: 'Text', label: 'Query', pattern: /[^\x00-\x1f\x7f-\x9f]/, available: visible},
    {id: 'searchBackspace', key: 'Backspace', label: 'Edit', keys: ['backspace'], available: visible},
    {id: 'searchBackspace', key: 'Del', label: 'Edit', keys: ['delete'], available: visible},
    {id: 'searchApply', key: 'Enter', label: 'Apply', keys: ['return'], available: visible},
    {id: 'searchCancel', key: 'Esc', label: 'Restore', keys: ['escape']},
  ],
  confirm: [
    {
      id: 'confirmEdit',
      key: 'DELETE',
      label: 'Type to confirm',
      compactLabel: 'Type',
      pattern: /^[a-zA-Z]+$/,
      available: visible,
    },
    {
      id: 'confirmBackspace',
      key: 'Backspace',
      label: 'Edit',
      keys: ['backspace'],
      available: (state) => visible(state) && Boolean(state.confirmationText),
    },
    {
      id: 'confirmBackspace',
      key: 'Del',
      label: 'Edit',
      keys: ['delete'],
      available: (state) => visible(state) && Boolean(state.confirmationText),
    },
    {id: 'confirmSubmit', key: 'Enter', label: 'Confirm', keys: ['return'], available: visible},
    {id: 'cancelPrompt', key: 'Esc', label: 'Cancel', keys: ['escape']},
  ],
  select: [
    {id: 'selectRemaining', key: 'Y/y', label: 'Load & select', chars: ['Y', 'y'], available: visible},
    {id: 'selectLoaded', key: 'N/n', label: 'Loaded only', chars: ['N', 'n'], available: visible},
    {id: 'cancelPrompt', key: 'Esc/C/c', label: 'Cancel', chars: ['C', 'c'], keys: ['escape']},
  ],
  busy: [
    {
      id: 'cancelOperation',
      key: 'Esc',
      label: 'Stop after request',
      compactLabel: 'Stop',
      keys: ['escape'],
      available: (state) => !state.cancelling,
    },
  ],
};
function activeBindings(state: FooterState): Binding[] {
  const mode = state.searching
    ? 'search'
    : state.confirm
      ? 'confirm'
      : state.selectPrompt
        ? 'select'
        : state.busy
          ? 'busy'
          : undefined;
  if (mode)
    return [
      helpBinding,
      ...modalBindings[mode].filter((binding) => !binding.available || binding.available(state)),
      interrupt,
    ];
  if (state.promptVisible === false) return [helpBinding, interrupt];
  return commands.filter((command) => command.available(state));
}
function matches(binding: Binding, input: string, key: Key): boolean {
  return Boolean(
    binding.chars?.includes(input) || binding.keys?.some((name) => key[name]) || binding.pattern?.test(input),
  );
}
export function commandFor(input: string, key: Key, state: FooterState): string | undefined {
  if (key.ctrl || key.meta) return;
  return activeBindings(state).find((binding) => matches(binding, input, key))?.id;
}
export function footerShortcuts(state: FooterState): Shortcut[] {
  const bindings = activeBindings(state).filter((binding) => !('hint' in binding && binding.hint));
  // Help is matched first so a text editor cannot consume '?', and displayed last.
  const ordered = bindings[0] === helpBinding ? [...bindings.slice(1, -1), helpBinding, interrupt] : bindings;
  return ordered.map((binding) => ({
    key: binding.key,
    label: binding.id === 'confirmSubmit' && !state.canConfirm ? 'Validate' : binding.label,
    compactLabel: binding.compactLabel,
  }));
}

const scrollBindings: Binding[] = [
  {id: 'scroll', key: '↑↓/jk', label: 'Scroll', chars: ['j', 'k'], keys: ['upArrow', 'downArrow']},
  {id: 'page', key: 'PgUp/PgDn', label: 'Page', keys: ['pageUp', 'pageDown']},
  {id: 'ends', key: 'Home/End', label: 'Ends', keys: ['home', 'end']},
];
export type ReaderMedia = {
  preview: boolean;
  open: boolean;
  busy: boolean;
  previous?: boolean;
  next?: boolean;
};
export function readerBindings(help: boolean, canScroll = true, media?: ReaderMedia): Binding[] {
  return [
    ...(canScroll ? scrollBindings.filter((binding) => !help || binding.id !== 'ends') : []),
    ...(!help && media
      ? [
          ...(media.previous ? [{id: 'mediaPrevious', key: '[', label: 'Previous item', chars: ['[']}] : []),
          ...(media.next ? [{id: 'mediaNext', key: ']', label: 'Next item', chars: [']']}] : []),
        ]
      : []),
    ...(!help && media && !media.busy
      ? [
          ...(media.preview
            ? [{id: 'mediaPreview', key: 'p', label: 'Retry preview', compactLabel: 'Retry', chars: ['p']}]
            : []),
          ...(media.open
            ? [{id: 'mediaOpen', key: 'o', label: 'Open media', compactLabel: 'Open', chars: ['o']}]
            : []),
        ]
      : []),
    {
      id: 'close',
      key: help ? 'Esc/?' : 'Esc/Enter',
      label: 'Close',
      chars: help ? ['?'] : [],
      keys: help ? ['escape'] : ['escape', 'return'],
    },
    interrupt,
  ];
}
export function readerCommand(
  input: string,
  key: Key,
  help: boolean,
  canScroll = true,
  media?: ReaderMedia,
): string | undefined {
  if (key.ctrl || key.meta) return;
  return readerBindings(help, canScroll, media).find((binding) => matches(binding, input, key))?.id;
}

export const filterBindings: Binding[] = [
  {id: 'up', key: '↑/k', label: 'Up', chars: ['k'], keys: ['upArrow']},
  {id: 'down', key: '↓/j', label: 'Down', chars: ['j'], keys: ['downArrow']},
  {id: 'toggle', key: 'Space', label: 'Toggle', chars: [' ']},
  {id: 'apply', key: 'Enter', label: 'Apply', keys: ['return']},
  {id: 'close', key: 'Esc', label: 'Cancel', keys: ['escape']},
  helpBinding,
  interrupt,
];
export function filterCommand(input: string, key: Key): string | undefined {
  if (key.ctrl || key.meta) return;
  return filterBindings.find((binding) => matches(binding, input, key))?.id;
}

export const helpSections = (
  [
    'Navigation',
    'Chat management',
    'Message selection',
    'Loading and pagination',
    'Deletion',
    'Layout and settings',
  ] as const
).map((title) => ({
  title,
  entries: [
    ...commands
      .filter((command) => command.group === title)
      .map((command) => [command.reference ?? command.key, command.description]),
    ...(title === 'Navigation'
      ? [
          ['Ctrl+C', 'Quit anytime; completed requests are not undone'],
          ['? / Esc', 'Close help; ↑↓ or j/k scroll help'],
          [
            'p / o in details',
            'Retry a failed preview (p appears only after failure) / download and open supported media in the system viewer',
          ],
          [
            '[ / ] in album details',
            'Previous / next album item for previewing or opening; each item retains its message ID',
          ],
        ]
      : []),
    ...(title === 'Message selection'
      ? [
          ...modalBindings.select.map((binding) => [binding.key, `Selection prompt: ${binding.label}`]),
          [
            'Album rows',
            'Space marks your loaded items; [~] means some are marked. Counts refer to individual messages.',
          ],
        ]
      : []),
    ...(title === 'Loading and pagination'
      ? [
          ['Esc', 'Stop between requests; in-flight request finishes'],
          ['?', 'Help during work; work continues in background'],
        ]
      : []),
    ...(title === 'Deletion'
      ? [
          ['DELETE + Enter', 'Exact uppercase confirmation; separate Enter event required'],
          ['Esc', 'Cancel prompt or stop after in-flight batch'],
          ['Requested / verified', 'API accepted / checked absent by message ID'],
        ]
      : []),
  ],
}));
