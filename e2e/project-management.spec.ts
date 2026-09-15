import { test, expect, Page } from '@playwright/test'
import { uiText } from './i18n'

interface MockSet {
  name: string
  path: string
  has_audio_pool: boolean
  projects: { name: string; path: string; has_project_file: boolean; has_banks: boolean }[]
}

const LEGACY_WRITE_DISABLED_MESSAGE =
  'LEGACY_WRITE_DISABLED: legacy write commands are disabled; use v2 change/rename flows'

const DISABLED_PROJECT_MANAGER_COMMANDS = new Set([
  'create_project',
  'copy_project',
  'copy_project_with_progress',
  'rename_project',
  'move_project',
  'move_project_with_progress',
  'delete_project',
  'create_set',
  'copy_set',
  'rename_set',
  'move_set',
  'move_set_with_progress',
  'delete_set',
])

test.use({ viewport: { width: 1280, height: 1024 } })

const initialState = {
  setA: {
    name: 'SetA',
    path: '/mock/SetA',
    has_audio_pool: true,
    projects: [
      { name: 'PROJ_A', path: '/mock/SetA/PROJ_A', has_project_file: true, has_banks: true },
      { name: 'PROJ_B', path: '/mock/SetA/PROJ_B', has_project_file: true, has_banks: true },
    ],
  } as MockSet,
  setB: {
    name: 'SetB',
    path: '/mock/SetB',
    has_audio_pool: true,
    projects: [
      { name: 'PROJ_C', path: '/mock/SetB/PROJ_C', has_project_file: true, has_banks: true },
    ],
  } as MockSet,
}

async function setupTauriMocks(page: Page) {
  await page.addInitScript(
    (payload: {
      state: typeof initialState
      disabledCommands: string[]
      legacyMessage: string
    }) => {
      const currentState = JSON.parse(JSON.stringify(payload.state)) as typeof payload.state
      const disabled = new Set(payload.disabledCommands)
      ;(window as any).__invokeCalls = [] as string[]
      ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      }
      ;(window as any).__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: async (cmd: string, args: any) => {
          if (cmd === 'plugin:event|listen') {
            return 0
          }
          if (cmd === 'plugin:event|unlisten') {
            return null
          }
          ;(window as any).__invokeCalls.push(cmd)
          if (disabled.has(cmd)) {
            throw new Error(payload.legacyMessage)
          }
          switch (cmd) {
            case 'scan_devices':
              return {
                locations: [
                  {
                    name: 'TestLoc',
                    path: '/mock',
                    device_type: 'LocalCopy',
                    sets: Object.values(currentState),
                  },
                ],
                standalone_projects: [],
              }
            case 'rescan_set': {
              return Object.values(currentState).find((s) => s.path === args.setPath)
            }
            case 'cancel_copy_operation':
              return null
            default:
              return null
          }
        },
      }
    },
    {
      state: initialState,
      disabledCommands: [...DISABLED_PROJECT_MANAGER_COMMANDS],
      legacyMessage: LEGACY_WRITE_DISABLED_MESSAGE,
    },
  )
}

async function invokeCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as any).__invokeCalls ?? [])])
}

async function clearInvokeCalls(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__invokeCalls = []
  })
}

function contextMenu(page: Page) {
  return page.locator('.context-menu')
}

async function openProjectContextMenu(page: Page, projectName: string) {
  const card = page.locator('.project-card.clickable-project', { hasText: projectName }).first()
  const box = await card.boundingBox()
  if (!box) {
    throw new Error(`project card not found: ${projectName}`)
  }
  await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' })
  return contextMenu(page)
}

async function openSetHeaderContextMenu(page: Page, setIndex = 0) {
  const header = page.locator('.set-header').nth(setIndex)
  const box = await header.boundingBox()
  if (!box) {
    throw new Error(`set header not found at index ${setIndex}`)
  }
  await page.mouse.click(box.x + 16, box.y + box.height / 2, { button: 'right' })
  return contextMenu(page)
}

function deleteDialog(page: Page) {
  return page.getByRole('dialog')
}

test.beforeEach(async ({ page }) => {
  await setupTauriMocks(page)
  await page.goto('/')
  await page.getByRole('button', { name: /scan/i }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
  await expect(page.getByText(uiText('ja', 'legacy.notice'))).toBeVisible()
})

// --- Project operations ---

test('create project via + card is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByLabel('New project in SetA').click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('NEW_ONE')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('NEW_ONE')).not.toBeVisible()
  expect(await invokeCalls(page)).toContain('create_project')
})

test('create project silently filters invalid chars', async ({ page }) => {
  await page.getByLabel('New project in SetA').click()
  const input = page.getByRole('textbox', { name: 'Project name' })
  await input.pressSequentially('BAD€OK')
  await expect(input).toHaveValue('BADOK')
})

test('rename via context menu is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  const menu = await openProjectContextMenu(page, 'PROJ_A')
  await menu.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: /new project name/i }).fill('RENAMED')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
  await expect(page.getByText('RENAMED')).not.toBeVisible()
  expect(await invokeCalls(page)).toContain('rename_project')
})

test('delete with confirmation dialog is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  const menu = await openProjectContextMenu(page, 'PROJ_A')
  await menu.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = deleteDialog(page)
  await expect(dialog.getByText(/cannot be undone/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
  expect(await invokeCalls(page)).toContain('delete_project')
})

test('delete cancellation keeps project and does not invoke delete', async ({ page }) => {
  await clearInvokeCalls(page)
  const menu = await openProjectContextMenu(page, 'PROJ_A')
  await menu.getByRole('button', { name: 'Delete', exact: true }).click()
  await deleteDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
  expect(await invokeCalls(page)).not.toContain('delete_project')
})

test('copy + paste is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  const menu = await openProjectContextMenu(page, 'PROJ_A')
  await menu.getByRole('button', { name: 'Copy', exact: true }).click()
  await openSetHeaderContextMenu(page, 0)
  await contextMenu(page).getByRole('button', { name: 'Paste Project', exact: true }).click()
  await expect(page.getByText('PROJ_A_2')).not.toBeVisible()
  expect(await invokeCalls(page)).toContain('copy_project_with_progress')
})

test('keyboard: Delete key opens confirmation', async ({ page }) => {
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('Delete')
  await expect(deleteDialog(page).getByText(/cannot be undone/i)).toBeVisible()
})

test('keyboard: F2 opens rename modal', async ({ page }) => {
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: /new project name/i })).toBeVisible()
})

test('copy shows confirmation toast', async ({ page }) => {
  const menu = await openProjectContextMenu(page, 'PROJ_A')
  await menu.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.locator('.toast-notification')).toContainText('PROJ_A')
})

test('context menu on set-card header shows set actions', async ({ page }) => {
  const menu = await openSetHeaderContextMenu(page, 0)
  await expect(menu.getByRole('button', { name: 'Copy Set', exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Rename Set', exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Delete Set', exact: true })).toBeVisible()
})

test('keyboard: Ctrl+C then Ctrl+V on Set grid does not paste while legacy writes are disabled', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.locator('.set-header').nth(1).click()
  await expect(page.getByText('PROJ_C')).toBeVisible()

  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('Control+c')

  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_C' }).first().focus()
  await page.keyboard.press('Control+v')

  await expect(page.locator('.project-card', { hasText: 'PROJ_A' })).toHaveCount(1)
})

// --- Set operations ---

test('context menu on set header shows set operations', async ({ page }) => {
  const menu = await openSetHeaderContextMenu(page, 0)
  await expect(menu.getByRole('button', { name: 'Copy Set', exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Rename Set', exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'Delete Set', exact: true })).toBeVisible()
})

test('rename set via context menu is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  const menu = await openSetHeaderContextMenu(page, 0)
  await menu.getByRole('button', { name: 'Rename Set', exact: true }).click()
  await page.getByRole('textbox', { name: /new project name/i }).fill('NEWSET')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.locator('.set-name', { hasText: 'SetA' })).toBeVisible()
  await expect(page.locator('.set-name', { hasText: 'NEWSET' })).not.toBeVisible()
  expect(await invokeCalls(page)).toContain('rename_set')
})

test('delete set via context menu is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  const menu = await openSetHeaderContextMenu(page, 0)
  await menu.getByRole('button', { name: 'Delete Set', exact: true }).click()
  const dialog = deleteDialog(page)
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('.set-name', { hasText: 'SetA' })).toBeVisible()
  expect(await invokeCalls(page)).toContain('delete_set')
})

test('delete set cancellation keeps set and does not invoke delete', async ({ page }) => {
  await clearInvokeCalls(page)
  const menu = await openSetHeaderContextMenu(page, 0)
  await menu.getByRole('button', { name: 'Delete Set', exact: true }).click()
  await deleteDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.set-name', { hasText: 'SetA' })).toBeVisible()
  expect(await invokeCalls(page)).not.toContain('delete_set')
})

test('create set via location context menu is blocked by legacy write gate', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept())
  await page.locator('.location-header').first().click({ button: 'right' })
  await contextMenu(page).getByRole('button', { name: 'New Set', exact: true }).click()
  await page.getByRole('textbox', { name: 'Set name' }).fill('BRAND_NEW')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.set-name', { hasText: 'BRAND_NEW' })).not.toBeVisible()
  expect(await invokeCalls(page)).toContain('create_set')
})

test('copy set shows toast', async ({ page }) => {
  const menu = await openSetHeaderContextMenu(page, 0)
  await menu.getByRole('button', { name: 'Copy Set', exact: true }).click()
  await expect(page.locator('.toast-notification')).toContainText('SetA')
})

test('location context menu shows paste set when set copied', async ({ page }) => {
  const menu = await openSetHeaderContextMenu(page, 0)
  await menu.getByRole('button', { name: 'Copy Set', exact: true }).click()
  await page.locator('.location-header').first().click({ button: 'right' })
  await expect(contextMenu(page).getByRole('button', { name: 'Paste Set', exact: true })).toBeVisible()
})
