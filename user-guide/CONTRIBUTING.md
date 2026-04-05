# User Guide — Contributing Guidelines

## Image Sizing in Documentation

### Full-app screenshots (2940px native @2x)

These display at 100% container width via standard markdown syntax. No special sizing needed:

```md
![Alt text](/img/screenshots/full-app-screenshot.png)
```

### Cropped / partial screenshots

Cropped screenshots must be explicitly sized so their UI elements appear at the **same visual scale** as in full-app screenshots.

**Formula:** `width = native_px / 2940 * 100%`, then multiply by **1.6** to keep them readable.

For example, a 1070px-wide crop: `1070 / 2940 * 100 * 1.6 ≈ 58%`

Use `<img>` with `require()` and percentage-based `style`. Center with `display: block` + `margin: 0 auto`:

```jsx
<img
  src={require('@site/static/img/screenshots/cropped-screenshot.png').default}
  alt="Description"
  style={{width: '58%', display: 'block', margin: '0 auto'}}
/>
```

**Reference table (native px → display %):**

| Native width | Display % | Examples |
|-------------|-----------|---------|
| ~650–700px  | 37–38%    | hover tooltips, file browser |
| ~740px      | 40%       | slot selectors (side-by-side, no centering) |
| ~850px      | 46%       | column filter popups |
| ~900–930px  | 50%       | toolbar sections, save/reload buttons |
| ~950–1000px | 52–54%    | status indicators, hide-empty toggles |
| ~1050–1080px| 58–60%    | search bars, warning dialogs |
| ~1150–1190px| 62–64%    | copy buttons, confirmation modals, toggles |

### Inline icon-sized screenshots

For tiny UI element captures (buttons, badges, version numbers) displayed inline with text, constrain by **height** (not width) and use `verticalAlign: 'middle'`:

```jsx
<img
  src={require('@site/static/img/screenshots/button.png').default}
  alt="Button"
  style={{height: '44px', verticalAlign: 'middle'}}
/>
```

Use `34px` height for thinner/shorter elements (status badges, version numbers).  
Use `44px` height for standard button captures.

### Important notes

- **Always use `require('@site/static/...')`** — bare paths like `/img/...` break in dev server due to `baseUrl: '/octatrack-manager/'`.
- Standard markdown `![alt](path)` automatically handles `baseUrl`; raw `<img src="...">` does not.
- **Side-by-side images** (e.g., One/Range mode): use `style={{width: '40%'}}` without centering so they sit next to each other.
- Run `npm run build` to verify all images resolve correctly after changes.
