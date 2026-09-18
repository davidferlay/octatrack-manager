import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../src/app/AppShell.css')
const css = readFileSync(cssPath, 'utf8')

function firstUnguardedWorkspaceRule(source) {
  const marker = '.mo-app-shell--workspace {'
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'missing unguarded .mo-app-shell--workspace rule')
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error('unclosed .mo-app-shell--workspace rule')
}

test('unguarded workspace height uses vh/calc only', () => {
  const body = firstUnguardedWorkspaceRule(css)
  assert.match(body, /height:\s*calc\(100vh - 18rem\)/)
  assert.match(body, /max-height:\s*calc\(100vh - 8rem\)/)
  assert.match(body, /min-height:\s*12rem/)
  assert.doesNotMatch(body, /dvh/)
  assert.doesNotMatch(body, /\bclamp\s*\(/)
  assert.doesNotMatch(body, /\bmin\s*\(/)
  assert.doesNotMatch(body, /\bmax\s*\(/)
})

test('expanded inner split switch is an explicit class, not :has()', () => {
  assert.match(css, /inner-split--slice-expanded/)
  assert.doesNotMatch(css, /:has\(\.root-registry-slice-workspace\)/)
})
