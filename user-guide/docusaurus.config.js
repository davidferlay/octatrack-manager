// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'MasterOCTa',
  tagline: 'An independent, unofficial desktop application for managing Elektron Octatrack projects',
  favicon: 'img/favicon.ico',

  url: 'https://kaz4g.github.io',
  baseUrl: '/masterocta/',

  organizationName: 'kaz4g',
  projectName: 'masterocta',
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
            href: '/masterocta/img/logo-192.png',
          },
          {
            tagName: 'link',
            rel: 'manifest',
            href: '/masterocta/manifest.json',
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
            href: '/masterocta/img/logo-192.png',
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
            'https://github.com/kaz4g/masterocta/tree/main/user-guide/',
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
      image: 'img/masterocta-social-card.jpg',
      navbar: {
        title: 'MasterOCTa',
        logo: {
          alt: 'MasterOCTa Logo',
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
            href: 'https://kaz4g.github.io/masterocta/masterocta-user-guide.pdf',
            label: 'PDF',
            position: 'right',
          },
          {
            href: 'https://github.com/kaz4g/masterocta',
            label: 'GitHub',
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
                label: 'Upstream community discussion',
                href: 'https://www.elektronauts.com/t/project-manager-for-octatrack/233672',
              },
              {
                label: 'GitHub Issues',
                href: 'https://github.com/kaz4g/masterocta/issues',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/kaz4g/masterocta',
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
