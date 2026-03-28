// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  customFields: {
    releaseVersion: process.env.RELEASE_VERSION || undefined,
  },

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

  plugins: [
    [
      '@docusaurus/plugin-pwa',
      {
        debug: false,
        offlineModeActivationStrategies: [
          'appInstalled',
          'standalone',
          'queryString',
        ],
        pwaHead: [
          {
            tagName: 'link',
            rel: 'icon',
            href: '/octatrack-manager/img/logo-192.png',
          },
          {
            tagName: 'link',
            rel: 'manifest',
            href: '/octatrack-manager/manifest.json',
          },
          {
            tagName: 'meta',
            name: 'theme-color',
            content: '#e85d04',
          },
          {
            tagName: 'meta',
            name: 'apple-mobile-web-app-capable',
            content: 'yes',
          },
          {
            tagName: 'meta',
            name: 'apple-mobile-web-app-status-bar-style',
            content: '#e85d04',
          },
          {
            tagName: 'link',
            rel: 'apple-touch-icon',
            href: '/octatrack-manager/img/logo-192.png',
          },
        ],
      },
    ],
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      ({
        hashed: true,
        highlightSearchTermsOnTargetPage: true,
        docsRouteBasePath: '/docs',
      }),
    ],
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/davidferlay/octatrack-manager/tree/main/user-guide/',
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
            label: 'User Guide',
          },
          {
            href: 'https://davidferlay.github.io/octatrack-manager/octatrack-manager-user-guide.pdf',
            label: 'PDF',
            position: 'right',
          },
          {
            href: 'https://github.com/davidferlay/octatrack-manager',
            label: 'GitHub',
            position: 'right',
          },
          {
            href: 'https://github.com/davidferlay/octatrack-manager/releases/latest',
            label: 'App',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'User Guide',
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
                href: 'https://www.elektronauts.com/t/project-manager-for-octatrack/233672',
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
                href: 'https://github.com/davidferlay/octatrack-manager/releases/latest',
              },
            ],
          },
        ],
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
