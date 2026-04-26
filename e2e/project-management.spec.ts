import { test, expect, Page } from '@playwright/test'

interface MockSet {
  name: string
  path: string
  has_audio_pool: boolean
  projects: { name: string; path: string; has_project_file: boolean; has_banks: boolean }[]
}

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
  await page.addInitScript((state) => {
    let currentState = JSON.parse(JSON.stringify(state)) as typeof state
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        switch (cmd) {
          case 'scan_devices':
            return {
              locations: [
                {
                  name: 'TestLoc',
                  path: '/mock',
                  device_type: 'LocalCopy',
                  sets: [currentState.setA, currentState.setB],
                },
              ],
              standalone_projects: [],
            }
          case 'create_project': {
            const set = Object.values(currentState).find((s) => s.path === args.setPath)!
            const newPath = `${args.setPath}/${args.name}`
            set.projects.push({
              name: args.name,
              path: newPath,
              has_project_file: true,
              has_banks: true,
            })
            return newPath
          }
          case 'delete_project': {
            for (const s of Object.values(currentState)) {
              s.projects = s.projects.filter((p) => p.path !== args.projectPath)
            }
            return null
          }
          case 'rename_project': {
            for (const s of Object.values(currentState)) {
              const p = s.projects.find((pr) => pr.path === args.projectPath)
              if (p) {
                p.name = args.newName
                p.path = `${s.path}/${args.newName}`
                return p.path
              }
            }
            throw new Error('Not found')
          }
          case 'copy_project': {
            const src = Object.values(currentState)
              .flatMap((s) => s.projects)
              .find((p) => p.path === args.srcPath)!
            const dest = Object.values(currentState).find((s) => s.path === args.destSetPath)!
            const baseName = src.name
            let newName = baseName
            let n = 2
            while (dest.projects.some((p) => p.name === newName)) {
              newName = `${baseName}_${n}`
              n++
            }
            const newProj = {
              name: newName,
              path: `${dest.path}/${newName}`,
              has_project_file: true,
              has_banks: true,
            }
            dest.projects.push(newProj)
            return newProj.path
          }
          case 'move_project': {
            const dest = Object.values(currentState).find((s) => s.path === args.destSetPath)!
            for (const s of Object.values(currentState)) {
              const i = s.projects.findIndex((p) => p.path === args.srcPath)
              if (i >= 0) {
                const [moved] = s.projects.splice(i, 1)
                moved.path = `${dest.path}/${moved.name}`
                dest.projects.push(moved)
                return moved.path
              }
            }
            throw new Error('Not found')
          }
          case 'rescan_set': {
            return Object.values(currentState).find((s) => s.path === args.setPath)
          }
          default:
            return null
        }
      },
    }
  }, initialState)
}

test.beforeEach(async ({ page }) => {
  await setupTauriMocks(page)
  await page.goto('/')
  await page.getByRole('button', { name: /scan/i }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
})

test('create project via + card', async ({ page }) => {
  await page.getByLabel('New project in SetA').click()
  await page.getByRole('textbox').fill('NEW_ONE')
  await page.getByRole('button', { name: /^create$/i }).click()
  await expect(page.getByText('NEW_ONE')).toBeVisible()
})

test('create project silently filters invalid chars', async ({ page }) => {
  await page.getByLabel('New project in SetA').click()
  const input = page.getByRole('textbox')
  // Type text with invalid char — € should be silently removed
  await input.pressSequentially('BAD€OK')
  await expect(input).toHaveValue('BADOK')
})

test('rename via context menu', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/rename/i).click()
  const input = page.getByRole('textbox', { name: /new project name/i })
  await input.fill('RENAMED')
  await page.getByRole('button', { name: /^rename$/i }).click()
  await expect(page.getByText('RENAMED')).toBeVisible()
  await expect(page.getByText('PROJ_A')).not.toBeVisible()
})

test('delete with confirmation dialog', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/delete/i).click()
  await expect(page.getByText(/cannot be undone/i)).toBeVisible()
  await page.getByRole('button', { name: /^delete$/i }).click()
  await expect(page.getByText('PROJ_A')).not.toBeVisible()
})

test('delete cancellation keeps project', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/delete/i).click()
  await page.getByRole('button', { name: /cancel/i }).click()
  await expect(page.getByText('PROJ_A')).toBeVisible()
})

test('copy + paste produces _2 suffix', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/^copy$/i).click()
  // Right-click on the set-header to get set context menu
  await page.locator('.set-header').first().click({ button: 'right' })
  await page.getByText(/paste/i).click()
  await expect(page.getByText('PROJ_A_2')).toBeVisible()
})

test('keyboard: Delete key opens confirmation', async ({ page }) => {
  // Focus the project-card div, not the inner text
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('Delete')
  await expect(page.getByText(/cannot be undone/i)).toBeVisible()
})

test('keyboard: F2 opens rename modal', async ({ page }) => {
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: /new project name/i })).toBeVisible()
})

test('copy shows confirmation toast', async ({ page }) => {
  await page.getByText('PROJ_A').click({ button: 'right' })
  await page.getByText(/^copy$/i).click()
  await expect(page.locator('.copy-toast')).toContainText('PROJ_A')
})

test('context menu on set-card header shows set actions', async ({ page }) => {
  await page.locator('.set-header').first().click({ button: 'right' })
  await expect(page.getByText(/new project/i)).toBeVisible()
})

test('keyboard: Ctrl+C then Ctrl+V on Set grid pastes', async ({ page }) => {
  // First, open SetB by clicking its header
  await page.locator('.set-header').nth(1).click()
  await expect(page.getByText('PROJ_C')).toBeVisible()

  // Focus the project card (not inner text) and copy
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_A' }).first().focus()
  await page.keyboard.press('Control+c')

  // Focus a card in SetB and paste
  await page.locator('.project-card.clickable-project', { hasText: 'PROJ_C' }).first().focus()
  await page.keyboard.press('Control+v')

  // PROJ_A pasted into SetB; in this mock state, name is unique so no _2 suffix.
  await expect(page.locator('.project-card', { hasText: 'PROJ_A' })).toHaveCount(2)
})
