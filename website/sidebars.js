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
        'features/project-detail',
        'features/audio-pool',
        'features/patterns',
        'features/parts-editor',
        {
          type: 'category',
          label: 'Tools',
          items: [
            'features/tools/index',
            'features/tools/copy-bank',
            'features/tools/copy-parts',
            'features/tools/copy-patterns',
            'features/tools/copy-tracks',
            'features/tools/copy-sample-slots',
          ],
        },
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
  ],
};

export default sidebars;
