// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Octatrack Manager',
  tagline: 'A desktop application for managing Elektron Octatrack projects',
  favicon: 'img/favicon.ico',

  url: 'https://davidferlay.github.io',
  baseUrl: '/octatrack-manager/',

  organizationName: 'davidferlay',
  projectName: 'octatrack-manager',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/davidferlay/octatrack-manager/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/octatrack-manager-social-card.jpg',
      navbar: {
        title: 'Octatrack Manager',
        logo: {
          alt: 'Octatrack Manager Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Documentation',
          },
          {
            href: 'https://github.com/davidferlay/octatrack-manager',
            label: 'GitHub',
            position: 'right',
          },
          {
            href: 'https://github.com/davidferlay/octatrack-manager/releases',
            label: 'Download',
            position: 'right',
          },
          {
            href: 'https://www.buymeacoffee.com/octatrackmanager',
            label: 'Buy Me a Coffee',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Getting Started',
                to: '/docs/intro',
              },
              {
                label: 'Installation',
                to: '/docs/getting-started/installation',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'Elektronauts Forum',
                href: 'https://www.elektronauts.com/t/file-manager-for-octatrack',
              },
              {
                label: 'GitHub Issues',
                href: 'https://github.com/davidferlay/octatrack-manager/issues',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/davidferlay/octatrack-manager',
              },
              {
                label: 'Releases',
                href: 'https://github.com/davidferlay/octatrack-manager/releases',
              },
              {
                label: 'Buy Me a Coffee',
                href: 'https://www.buymeacoffee.com/octatrackmanager',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Octatrack Manager. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
    }),
};

export default config;
