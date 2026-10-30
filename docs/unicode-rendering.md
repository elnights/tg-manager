# Unicode terminal rendering

## Root cause

The synthetic title `Sample✈️` includes U+2708 AIRPLANE and U+FE0F VARIATION
SELECTOR-16. Ink measures this grapheme as two terminal cells. A terminal may
advance a different number of cells, shifting the following divider and
breaking selection backgrounds. Fixed Yoga boxes alone cannot enforce the
physical cursor position: Ink serializes them into continuous terminal text.

Replaying output in xterm 6.0.0 reproduces the mismatch. These are Unicode
provider names, rather than terminal application versions:

| xterm provider                | Cells advanced for `✈️` | Divider column (expected 24, zero-based) |
| ----------------------------- | ----------------------: | ---------------------------------------: |
| `6`                           |                       1 |                                       23 |
| `15` without grapheme joining |                       3 |                                       25 |
| `15-graphemes`                |                       2 |                                       24 |

At a panel edge, overwriting an extra emoji continuation with an unhighlighted
divider can also erase the preceding highlighted cell. Logical layout tests
alone cannot detect this disagreement; terminal-buffer tests interpret cursor
movement, styles and actual cell allocation.

## Solution

[`src/terminal-output.ts`](../src/terminal-output.ts) wraps Ink's output stream.
For each wide grapheme it positions the cursor at the intended column, paints
its cells using the active background, writes the complete original sequence,
and positions the cursor at the intended ending column. It clears excess
terminal continuations while the glyph background is still active and leaves
the following cell clean for its owner before restoring the cursor and style.

The adapter tracks cursor instructions, line breaks and SGR backgrounds,
forwards dimensions and resize events, and removes listeners when disposed.
Redirected output passes through unchanged. Selectors, combining marks and
joiners remain intact; titles and messages are never replaced with approximations.

Ink owns layout, row backgrounds and grapheme-aware truncation using the same
deduplicated `string-width` dependency as the adapter. `src/ui.tsx` bounds panels
and reserves a physical column to prevent autowrap. Ink 8's
[wide-cell and clipping fixes](https://github.com/vadimdemedes/ink/releases/tag/v8.0.0)
are part of the rendering stack. Ink also supplies the alternate screen and
window-size hook. No custom Unicode width table is maintained.

## Regression coverage

`test/ui.test.tsx` covers logical widths, intact graphemes, truncation,
full-row selection backgrounds, panel sizing and keyboard input.
`test/terminal-output.test.tsx` checks xterm's actual terminal buffer:

- One-, two- and three-cell interpretations of `✈️`, including the failing baseline.
- `Sample✈️` at widths 10, 11, 12, 24 and 40, selected and unselected.
- Glyphs at the panel edge, background repair and the reserved column.
- Joined emoji, flags, combining marks and redirected output.
- Live focus/selection changes and resize to 60×12, 40×8, 110×28 and 80×16.
- Divider alignment, stale highlighting, unexpected scrolling and listener cleanup.

Run `npm test` and `npm run typecheck`. For a visual check, run
`npm run repro:emoji` in iTerm2, macOS Terminal or VS Code Terminal. The offline
demo uses the production output adapter and synthetic titles; it never reads
Telegram sessions or credentials or changes settings.

## Limitations

Font fallback and color-emoji rasterization depend on the terminal. Explicit
positioning repairs alignment and backgrounds but cannot add combined-glyph
support to a terminal without grapheme support. The original sequence is always
emitted intact. Test emulators complement visual checks in actual terminals.
