# Browser baseline

The site keeps browser-native behavior and only normalizes differences that cause
real usability problems:

- Border-box sizing includes pseudo-elements.
- Media cannot overflow narrow containers by default.
- Form controls inherit typography and text color. Editable controls have a
  minimum font size of 16 CSS px, avoiding Safari's focus zoom on small inputs.
- Keyboard focus remains visible and works on all native controls.
- Touch-action manipulation prevents unnecessary double-tap behavior on
  controls while retaining pinch zoom and scrolling.
- The body is not forced to be at least 320 px wide, and overflow is tested
  rather than hidden.

Use semantic HTML and native inputs. Do not set `user-scalable=no`,
`maximum-scale=1`, global `overflow-x: hidden`, or
`user-select: none` as normalization shortcuts.

Form validation, autocomplete details, full-height viewport handling, safe
areas and dialogs belong to the features that need them.
