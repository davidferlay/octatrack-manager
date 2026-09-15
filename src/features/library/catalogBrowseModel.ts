import type {
  LibraryAudioFile,
  LibraryProject,
  LibrarySet,
  LibrarySnapshot,
} from "../../api";
import type { TranslateFn } from "../../i18n";

export type CatalogSourceOption =
  | { key: string; kind: "set"; label: string; set: LibrarySet }
  | { key: string; kind: "standalone"; label: string }
  | { key: string; kind: "unclassified"; label: string };

export type CatalogLocationOption =
  | { key: string; kind: "audio_pool"; label: string; parentPath: string }
  | { key: string; kind: "project"; label: string; project: LibraryProject }
  | { key: string; kind: "unclassified"; label: string };

export function isWithin(relativePath: string, parentPath: string): boolean {
  return relativePath.startsWith(`${parentPath}/`);
}

export function catalogSourceOptions(snapshot: LibrarySnapshot): CatalogSourceOption[] {
  const options: CatalogSourceOption[] = snapshot.sets.map((set) => ({
    key: `set:${set.relativePath}`,
    kind: "set",
    label: set.displayName,
    set,
  }));
  if (snapshot.standaloneProjects.length > 0) {
    options.push({ key: "standalone", kind: "standalone", label: "Standalone" });
  }
  if (snapshot.audioFiles.some((file) => file.storageScope === "unclassified")) {
    options.push({ key: "unclassified", kind: "unclassified", label: "Unclassified" });
  }
  return options;
}

export function catalogLocationsFor(
  source: CatalogSourceOption | undefined,
  snapshot: LibrarySnapshot,
): CatalogLocationOption[] {
  if (source?.kind === "set") {
    const locations: CatalogLocationOption[] = [];
    if (source.set.hasAudioPool) {
      locations.push({
        key: `pool:${source.set.relativePath}`,
        kind: "audio_pool",
        label: "Audio Pool",
        parentPath: source.set.relativePath,
      });
    }
    locations.push(
      ...source.set.projects.map((project) => ({
        key: `project:${project.relativePath}`,
        kind: "project" as const,
        label: project.displayName,
        project,
      })),
    );
    return locations;
  }
  if (source?.kind === "standalone") {
    return snapshot.standaloneProjects.map((project) => ({
      key: `project:${project.relativePath}`,
      kind: "project" as const,
      label: project.displayName,
      project,
    }));
  }
  if (source?.kind === "unclassified") {
    return [{ key: "unclassified", kind: "unclassified", label: "Unknown scope" }];
  }
  return [];
}

export function catalogFilesForLocation(
  location: CatalogLocationOption | undefined,
  audioFiles: LibraryAudioFile[],
): LibraryAudioFile[] {
  const files = audioFiles.filter((file) => {
    if (location?.kind === "audio_pool") {
      return file.storageScope === "set_audio_pool"
        && isWithin(file.relativePath, location.parentPath);
    }
    if (location?.kind === "project") {
      return file.storageScope === "project_local"
        && isWithin(file.relativePath, location.project.relativePath);
    }
    return location?.kind === "unclassified" && file.storageScope === "unclassified";
  });
  return files.sort((left, right) => {
    if (left.relativePath < right.relativePath) return -1;
    if (left.relativePath > right.relativePath) return 1;
    return 0;
  });
}

export function displayCatalogSourceLabel(source: CatalogSourceOption, t: TranslateFn): string {
  if (source.kind === "standalone") return t("library.sourceStandalone");
  if (source.kind === "unclassified") return t("library.sourceUnclassified");
  return source.label;
}

export function displayCatalogLocationLabel(
  location: CatalogLocationOption,
  t: TranslateFn,
): string {
  if (location.kind === "audio_pool") return t("library.locationAudioPool");
  if (location.kind === "unclassified") return t("library.locationUnknownScope");
  return location.label;
}

export function formatCatalogBytes(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtensionFromName(displayName: string): string {
  const dot = displayName.lastIndexOf(".");
  if (dot <= 0 || dot === displayName.length - 1) return "—";
  return displayName.slice(dot + 1).toUpperCase();
}
