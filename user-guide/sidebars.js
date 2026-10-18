// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
      ],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        'features/project-discovery',
        'features/project-management',
        'features/audio-pool',
        'features/project-detail',
        'features/navigation',
        'features/undo-redo',
        'features/parts-editor',
        'features/scenes',
        'features/patterns',
        'features/sample-slots',
        'features/copy-bank',
        'features/copy-parts',
        'features/copy-scenes',
        'features/copy-patterns',
        'features/copy-tracks',
        'features/copy-sample-slots',
        'features/fix-missing-samples',
        'features/fix-incompatible-samples',
        'features/purge-unused-samples',
        'features/clear-project',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/keyboard-shortcuts',
        'reference/compatibility',
      ],
    },
    'contributing',
  ],
};

export default sidebars;
