# Unicode rendering investigation

## Reproduction and root cause

The neutral example `Sample✈️` contains six ASCII letters, U+2708 AIRPLANE,
and U+FE0F VARIATION SELECTOR-16. Ink's `string-width` correctly measures the
airplane sequence as two cells. That does not ensure the terminal advances
two cells when it receives that sequence.

The previous fix used separate fixed-width Yoga boxes and a Box background.
It still failed because Ink serializes those boxes into continuous terminal
text. Spaces between the title and divider depend on the terminal agreeing
with Ink's emoji width. A separate separator Box does not produce a terminal
cursor-positioning instruction.

Replaying the actual output through xterm 6.0.0 with its available Unicode
providers reproduces the discrepancy. These are Unicode provider names, not
terminal application version numbers:

| xterm provider | Cells advanced for `✈️` | Actual divider column, expected 24 (zero-based) |
| --- | ---: | ---: |
| `6` | 1 | 23 |
| `15` without grapheme joining | 3 | 25 |
| `15-graphemes` | 2 | 24 |

The non-joining `15` provider treats the selector as a separate wide cell.
This reproduces the reported rightward displacement. When the emoji ends
exactly at the row boundary, overwriting that extra continuation with an
unhighlighted divider can also clear the preceding highlighted cell. Tests
now reproduce both defects.

The previous tests decoded ANSI with an assumed two-cell emoji width. They
verified Ink's logical layout but could not detect disagreement with the
terminal's actual cell allocation. The new tests inspect xterm's buffer cells
after interpreting the output, cursor movement and SGR styles.

The regression covers one-, two- and three-cell interpretations of this
sequence without requiring a terminal preference change.

## Fix

`src/terminal-output.ts` wraps Ink's output stream. For every wide grapheme it:

1. Positions the cursor at the intended terminal column and paints the cells
   using the current background.
2. Writes the original, complete grapheme, including selectors and joiners.
3. Positions the cursor at the intended ending column. It clears an excess
   terminal continuation while the glyph's background is still active, before
   a divider or subsequent text changes that style.
4. Leaves the following cell clean for its owner, then restores the active
   background and cursor position.

The adapter tracks existing cursor instructions, line breaks and SGR background
changes. It forwards terminal dimensions and resize events to Ink, removes its
listener when disposed, and passes redirected output through unchanged. It
does not replace emoji or change Telegram titles/messages.

Ink remains responsible for layout, row padding and grapheme-aware truncation.
The output adapter uses the same deduplicated `string-width` 8.3.0 as Ink,
`cli-truncate` and `wrap-ansi`; there is no custom Unicode width table.
`src/ui.tsx` retains fixed-width rows, a dedicated divider, bounded panel sizes,
full-row Box backgrounds and `[`, `]`, `0` adjustment behavior.

## Runtime and dependency changes

Node 24 is now required. Ink was upgraded from 6.8.0 to 8.0.0 and React's
declared minimum is 19.3.1. The old tokenizer override was removed. The locked
stack includes tokenizer 0.3.1, cli-truncate 6.1.1, wrap-ansi 10.0.2 and
string-width 8.3.0. Type definitions match Node 24 and React 19.3.

Ink 8 includes upstream fixes for clipping wide cells, preserving backgrounds,
nested clips and terminal resize rendering
([release notes](https://github.com/vadimdemedes/ink/releases/tag/v8.0.0)).
Upgrading alone still reproduced the width mismatch above, so the output
adapter is needed. Ink's `alternateScreen` option and `useWindowSize` hook
replace the application's manual alternate-screen sequences and resize hook.

## Files

- `src/terminal-output.ts`: terminal-column positioning and background repair.
- `src/ui.tsx`: fixed row/panel layout and Ink's window-size hook.
- `src/index.tsx`: startup and the terminal output adapter/alternate screen.
- `src/App.tsx`: chat and message view using the fixed-width panels.
- `src/emoji-demo.tsx`: same production output adapter, starts with `Sample✈️`.
- `test/terminal-output.test.tsx`: real terminal-buffer regressions, including
  both broken baseline models, boundary backgrounds and live resizing.
- `test/ui.test.tsx`: logical layout, grapheme, truncation and input tests.
- `package.json`, `package-lock.json`: runtime requirements, upgraded renderer
  and development-only xterm test packages.
- `tsconfig.json`, `README.md`: test typechecking and updated setup instructions.

Rendering regressions run without Telegram network requests, login or deletion.
No credentials or session files are needed by the tests.

## Verification and limits

```sh
npm test
npm run typecheck
npm run repro:emoji
```

The rendering suite has 32 tests. In addition to the logical row-width and truncation
checks, terminal-buffer tests verify `Sample✈️` at panel widths 10, 11, 12, 24
and 40, with and without selection, under all three providers. They check an
airplane exactly at the right panel edge, background coverage, the reserved
column, cursor movement and redirected output. The combined-emoji tests cover
all originally requested sequences under the grapheme-aware provider.

The live emulator test runs the production adapter and Ink together, sends
width/selection keys, and resizes to 60×12, 40×8, 110×28 and 80×16. It checks
the actual terminal buffer for a vertical divider, stale highlighting and
unexpected scrolling, and verifies resize-listener cleanup.

Terminal font fallback and color-emoji rasterization still depend on the
terminal. A provider without grapheme support cannot display a combined emoji
as a single glyph; explicit positioning repairs alignment/background but cannot
add that font/terminal capability. The original emoji sequence is always
emitted intact. The interactive demo provides a visual check in iTerm2 and the
VS Code terminal without touching Telegram data or settings.
