import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PoolUsageEntry } from '../types/audioFile'

type UsageMap = Record<string, PoolUsageEntry[]>

// Module-level so every consumer (Audio Pool page, Fix Project Samples, the
// Sample Slots audio pool sidebar) shares one cache per pool path instead of
// each re-running the same cross-project scan independently.
const cache = new Map<string, UsageMap>()
const inflight = new Map<string, Promise<UsageMap>>()
const listeners = new Map<string, Set<() => void>>()

function notify(poolPath: string) {
  listeners.get(poolPath)?.forEach(fn => fn())
}

/**
 * Drop the cached usage for a pool (or every pool when omitted) and tell every
 * mounted usePoolUsage(poolPath) to refetch. Call after anything that changes
 * which projects reference a pool file: assigning/clearing a sample slot,
 * converting a file in place, renaming/deleting a pool file, etc.
 */
export function invalidatePoolUsage(poolPath?: string) {
  if (poolPath) {
    cache.delete(poolPath)
    notify(poolPath)
  } else {
    const paths = Array.from(cache.keys())
    cache.clear()
    paths.forEach(notify)
  }
}

function fetchPoolUsage(poolPath: string): Promise<UsageMap> {
  const existing = inflight.get(poolPath)
  if (existing) return existing
  const promise = invoke<UsageMap>('get_pool_usage', { poolPath })
    .then(result => {
      const data = result ?? {}
      cache.set(poolPath, data)
      return data
    })
    .finally(() => { inflight.delete(poolPath) })
  inflight.set(poolPath, promise)
  return promise
}

/**
 * Cross-project usage of Audio Pool files (get_pool_usage), cached per pool
 * path so browsing between the Audio Pool page, Fix Project Samples, and the
 * Sample Slots sidebar doesn't re-trigger the same set-wide scan. Stays cached
 * until invalidatePoolUsage(poolPath) is called.
 */
export function usePoolUsage(poolPath: string | null | undefined) {
  const [usageMap, setUsageMap] = useState<UsageMap>(() => (poolPath && cache.get(poolPath)) || {})
  const [usageLoading, setUsageLoading] = useState(false)

  useEffect(() => {
    if (!poolPath) { setUsageMap({}); setUsageLoading(false); return }
    let cancelled = false

    const load = () => {
      const cached = cache.get(poolPath)
      if (cached) { setUsageMap(cached); setUsageLoading(false); return }
      setUsageLoading(true)
      fetchPoolUsage(poolPath)
        .then(data => { if (!cancelled) setUsageMap(data) })
        .catch(e => console.error('Pool usage scan failed:', e))
        .finally(() => { if (!cancelled) setUsageLoading(false) })
    }
    load()

    if (!listeners.has(poolPath)) listeners.set(poolPath, new Set())
    const set = listeners.get(poolPath)!
    set.add(load)

    return () => {
      cancelled = true
      set.delete(load)
      if (set.size === 0) listeners.delete(poolPath)
    }
  }, [poolPath])

  return { usageMap, usageLoading }
}
