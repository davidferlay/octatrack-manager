/**
 * The keyboard shortcuts shown in the Keyboard shortcuts window, for the page on screen.
 * Kept in step with user-guide/docs/reference/keyboard-shortcuts.md, which explains each
 * one in full; this is the short form.
 */

export type ShortcutPage = 'home' | 'project' | 'audio-pool';

export interface ShortcutGroup {
  title: string;
  rows: { keys: string; action: string }[];
}

const group = (title: string, rows: [string, string][]): ShortcutGroup =>
  ({ title, rows: rows.map(([keys, action]) => ({ keys, action })) });

const EVERYWHERE = group('Everywhere', [
  ['Ctrl + / - / 0', 'Zoom the interface in / out / back to 100%'],
  ['?', 'Open or close this window'],
  ['Escape', 'Close the window or menu on top'],
  ['Tab / Shift + Tab', 'Move focus to the next / previous control'],
]);

const HOME = group('Projects list', [
  ['Ctrl + F', 'Search the projects'],
  ['Arrows', 'Move between the projects of a Set'],
  ['Enter', 'Open the focused project'],
  ['F2', 'Rename the focused project'],
  ['Delete', 'Delete the focused project'],
  ['Ctrl + C / Ctrl + V', 'Copy the focused project / paste it into its Set'],
]);

const PROJECT = group('Project', [
  ['E', 'Switch between View and Edit mode'],
  ['Shift + 1..7', 'Overview, Parts, Scenes, Patterns, Flex, Static, Tools'],
  ['Left / Right', 'Move between banks, Parts or patterns'],
  ['Up / Down', 'Move between the bank, track and pattern selectors'],
]);

const PARTS = group('Parts', [
  ['D', 'Edit mode: show what differs from the saved copy'],
]);

const SCENES = group('Scenes', [
  ['D', 'Edit mode: show what differs from the saved copy'],
  ['Shift + click', 'Matrix: select a range of scenes'],
  ['Ctrl + click', 'Matrix: add or remove one scene'],
]);

const SLOTS = group('Sample slots', [
  ['Ctrl + F', 'Search the slots'],
  ['Up / Down', 'Move through the slots'],
  ['Shift + click', 'Select a run of slots'],
  ['Ctrl + click', 'Add or remove one slot'],
  ['Drag', 'Edit mode: move the selected slots'],
  ['Delete', 'Edit mode: clear the selected slots'],
  ['Enter', 'Copy the file name'],
  ['A', 'Show or hide the Audio Pool pane'],
  ['T', 'Show or hide the Transfers pane'],
]);

const PREVIEW = group('Sample preview', [
  ['Space', 'Play / pause'],
  ['Ctrl + Left / Right', 'Scrub backward / forward'],
  ['Ctrl + Up / Down', 'Preview volume up / down'],
  ['Shift + Enter', 'Turn AUTO play on or off'],
  ['Shift + L', 'Turn LOOP on or off'],
]);

const TOOLS = group('Tools', [
  ['Tab', 'Move through the source and destination choices'],
  ['Space', 'Toggle the focused bank, Part or track'],
  ['Shift + click', 'Select a range of source banks or patterns'],
  ['Ctrl + click', 'Add or remove one source bank or pattern'],
  ['Enter', 'Run the copy (on its button)'],
]);

const AUDIO_POOL = group('Audio Pool', [
  ['Ctrl + F', 'Search the files'],
  ['Up / Down', 'Move through the files'],
  ['Enter / Backspace', 'Open the folder / go up a folder'],
  ['Shift + click', 'Select a range of files'],
  ['Ctrl + click', 'Add or remove one file'],
  ['Ctrl + A', 'Select every file in the folder'],
  ['B', 'Show or hide the Browse pane'],
  ['T', 'Show or hide the Transfers pane'],
  ['Shift + 1 / 2', 'Files / Tools'],
]);

const TABS: Record<string, ShortcutGroup[]> = {
  parts: [PARTS],
  scenes: [SCENES],
  'flex-slots': [SLOTS, PREVIEW],
  'static-slots': [SLOTS, PREVIEW],
  tools: [TOOLS],
};

/**
 * The groups for `page`, the page's own first and Everywhere last. On the project page
 * `section` is the open tab. `mac` says Cmd for Ctrl.
 */
export function shortcutsFor(page: ShortcutPage, section?: string, mac = false): ShortcutGroup[] {
  const groups = page === 'home' ? [HOME, EVERYWHERE]
    : page === 'audio-pool' ? [AUDIO_POOL, PREVIEW, EVERYWHERE]
    : [...(TABS[section ?? ''] ?? []), PROJECT, EVERYWHERE];
  if (!mac) return groups;
  return groups.map(g => ({ ...g, rows: g.rows.map(r => ({ ...r, keys: r.keys.replace(/Ctrl/g, 'Cmd') })) }));
}

/** Whether the app runs on macOS, where Cmd stands in for Ctrl. */
export const isMac = () => /Mac/.test(navigator.platform || navigator.userAgent);
