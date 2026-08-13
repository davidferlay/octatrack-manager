import type { OctatrackLocation, OctatrackProject } from '../types/projectManagement'

export interface FilteredProjects {
  locations: OctatrackLocation[]
  standaloneProjects: OctatrackProject[]
}

/**
 * Narrows the Home page tree to projects whose name contains `query`.
 *
 * Sets keep only their matching projects and disappear when none remain; a Location
 * disappears when all of its Sets did. Set names, Location names and paths are
 * deliberately not searched - a Set is visible only because a project inside it matched.
 *
 * An empty or whitespace-only query returns the inputs by reference, so the non-search
 * render path allocates nothing.
 */
export function filterProjects(
  locations: OctatrackLocation[],
  standaloneProjects: OctatrackProject[],
  query: string,
): FilteredProjects {
  const needle = query.trim().toLowerCase()
  if (!needle) return { locations, standaloneProjects }

  const matches = (p: OctatrackProject) => p.name.toLowerCase().includes(needle)

  const filteredLocations: OctatrackLocation[] = []
  for (const location of locations) {
    const sets = location.sets
      .map((set) => ({ ...set, projects: set.projects.filter(matches) }))
      .filter((set) => set.projects.length > 0)
    if (sets.length > 0) filteredLocations.push({ ...location, sets })
  }

  return {
    locations: filteredLocations,
    standaloneProjects: standaloneProjects.filter(matches),
  }
}
