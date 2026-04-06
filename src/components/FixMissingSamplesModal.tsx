import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface MissingSample {
  filename: string;
  original_path: string;
  slot_type: string;
  flex_slot_ids: number[];
  static_slot_ids: number[];
}

interface FoundSample {
  filename: string;
  found_path: string;
  source_project: string | null;
}

interface SampleResolution {
  filename: string;
  found_path: string;
  action: string;
  new_slot_path: string;
}

interface FixResult {
  resolved_count: number;
  files_copied: number;
  files_moved: number;
  projects_updated: string[];
}

type PoolOption = "use_from_pool" | "copy_to_project";
type OtherProjectOption = "move_to_pool" | "copy_to_project";

type ModalPhase = "searching" | "search_done" | "confirming" | "applying" | "done";

interface SearchStep {
  label: string;
  status: "pending" | "running" | "done" | "skipped";
  foundCount: number;
  fullPath?: string; // Full path for user-selected directories (used in tooltip)
}

interface ResolvedFile {
  filename: string;
  found_path: string;
  source: string; // "project", "pool", "other_project", "user_dir"
  source_project?: string;
  action: string;
  new_slot_path: string;
  color: string; // CSS class for color coding
}

interface Props {
  projectPath: string;
  projectName: string;
  missingSamples: MissingSample[];
  poolOption: PoolOption;
  otherProjectOption: OtherProjectOption;
  hasAudioPool: boolean;
  skipReview: boolean;
  onClose: () => void;
  onApplied: () => void;
}

export function FixMissingSamplesModal({
  projectPath,
  projectName: _projectName,
  missingSamples,
  poolOption,
  otherProjectOption,
  hasAudioPool,
  skipReview,
  onClose,
  onApplied,
}: Props) {
  const [phase, setPhase] = useState<ModalPhase>("searching");
  const [steps, setSteps] = useState<SearchStep[]>([
    { label: "Project directory", status: "pending", foundCount: 0 },
    { label: "Audio Pool", status: "pending", foundCount: 0 },
    { label: "Other Set projects", status: "pending", foundCount: 0 },
  ]);

  // Capture initial count so it doesn't change when parent refreshes missingSamples
  const initialMissingCount = useRef(missingSamples.length);

  // All found files (accumulated across search steps)
  const [resolvedFiles, setResolvedFiles] = useState<ResolvedFile[]>([]);
  const [remainingFilenames, setRemainingFilenames] = useState<string[]>(
    missingSamples.map((s) => s.filename)
  );

  // Browse prompt state
  const [searchedDirs, setSearchedDirs] = useState<string[]>([]);
  const [dirWarning, setDirWarning] = useState<string>("");
  const [dirWarningFading, setDirWarningFading] = useState(false);
  const dirWarningTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Apply result
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [applyError, setApplyError] = useState<string>("");

  // Modal resize
  const [modalWidth, setModalWidth] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isModalDragging = useRef<"left" | "right" | "bottom" | null>(null);
  const modalDragStartX = useRef(0);
  const modalDragStartWidth = useRef(0);

  // Column resize
  const [colWidths, setColWidths] = useState<number[]>([]);
  const colDragIndex = useRef<number | null>(null);
  const colDragStartX = useRef(0);
  const colDragStartWidths = useRef<number[]>([]);
  const tableRef = useRef<HTMLTableElement>(null);

  // Sorting and filtering for confirmation table
  type ConfirmSortColumn = "file" | "found" | "location" | "action";
  type SortDirection = "asc" | "desc";
  const [confirmSortColumn, setConfirmSortColumn] = useState<ConfirmSortColumn>("found");
  const [confirmSortDirection, setConfirmSortDirection] = useState<SortDirection>("desc");
  const [confirmSearchText, setConfirmSearchText] = useState("");
  const [foundFilter, setFoundFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [confirmOpenDropdown, setConfirmOpenDropdown] = useState<string | null>(null);
  const [confirmDropdownPosition, setConfirmDropdownPosition] = useState<{ top: number; left: number } | null>(null);

  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied">("idle");

  // Auto-apply: when skipReview enabled and all samples found, apply immediately
  const autoApplyTriggered = useRef(false);

  const closeConfirmDropdown = () => {
    setConfirmOpenDropdown(null);
    setConfirmDropdownPosition(null);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!confirmOpenDropdown) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest(".filter-dropdown") && !target.closest(".filter-icon")) {
        setConfirmOpenDropdown(null);
        setConfirmDropdownPosition(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmOpenDropdown]);

  const copyConfirmTableToClipboard = async () => {
    const headers = ["File", "Found", "Location", "Action"];
    const tsvRows = sortedConfirmRows.map(
      (row) => `${row.filename}\t${row.found ? "Yes" : "No"}\t${row.location}\t${row.actionLabel}`
    );
    const tsv = [headers.join("\t"), ...tsvRows].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      setCopyFeedback("copied");
      setTimeout(() => setCopyFeedback("idle"), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  const handleConfirmSort = (column: ConfirmSortColumn) => {
    if (confirmSortColumn === column) {
      setConfirmSortDirection(confirmSortDirection === "asc" ? "desc" : "asc");
    } else {
      setConfirmSortColumn(column);
      setConfirmSortDirection("asc");
    }
  };

  const handleModalResizeMouseDown = useCallback(
    (side: "left" | "right" | "bottom", e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isModalDragging.current = side;
      modalDragStartX.current = e.clientX;
      modalDragStartWidth.current =
        modalRef.current?.getBoundingClientRect().width ?? 700;
    },
    []
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (isModalDragging.current) {
        const delta = e.clientX - modalDragStartX.current;
        const multiplier = isModalDragging.current === "right" ? 2 : -2;
        const newWidth = Math.max(
          400,
          Math.min(window.innerWidth * 0.95, modalDragStartWidth.current + delta * multiplier)
        );
        setModalWidth(newWidth);
      }
      if (colDragIndex.current !== null) {
        const delta = e.clientX - colDragStartX.current;
        const idx = colDragIndex.current;
        const prev = colDragStartWidths.current;
        const minW = 40;
        const newLeft = Math.max(minW, prev[idx] + delta);
        const newRight = Math.max(minW, prev[idx + 1] - delta);
        setColWidths((w) => {
          const copy = [...w];
          copy[idx] = newLeft;
          copy[idx + 1] = newRight;
          return copy;
        });
      }
    }
    function handleMouseUp() {
      isModalDragging.current = null;
      colDragIndex.current = null;
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Initialize column widths from actual header widths when confirming phase starts
  useEffect(() => {
    if (phase === "confirming" && tableRef.current && colWidths.length === 0) {
      const ths = tableRef.current.querySelectorAll("thead th");
      const widths = Array.from(ths).map((th) => (th as HTMLElement).offsetWidth);
      if (widths.length > 0) setColWidths(widths);
    }
  }, [phase, colWidths.length]);

  useEffect(() => {
    if (
      skipReview &&
      phase === "search_done" &&
      resolvedFiles.length > 0 &&
      !autoApplyTriggered.current
    ) {
      autoApplyTriggered.current = true;
      handleApply();
    }
  }, [phase, skipReview, resolvedFiles.length]);

  const handleColResizeMouseDown = useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      colDragIndex.current = colIndex;
      colDragStartX.current = e.clientX;
      // Capture current widths from DOM if state not yet set
      if (tableRef.current) {
        const ths = tableRef.current.querySelectorAll("thead th");
        const widths = Array.from(ths).map((th) => (th as HTMLElement).offsetWidth);
        colDragStartWidths.current = widths;
        setColWidths(widths);
      }
    },
    []
  );

  // Compute resolutions for the confirmation screen
  const buildResolution = useCallback(
    (file: ResolvedFile): SampleResolution => {
      return {
        filename: file.filename,
        found_path: file.found_path,
        action: file.action,
        new_slot_path: file.new_slot_path,
      };
    },
    []
  );

  // Determine action and path for a found file based on its source and options
  function resolveAction(
    filename: string,
    found_path: string,
    source: string,
    source_project?: string
  ): ResolvedFile {
    let action: string;
    let new_slot_path: string;
    let color: string;

    switch (source) {
      case "project": {
        // Found in project dir — compute relative path from project root
        const projectPrefix = projectPath.endsWith("/")
          ? projectPath
          : projectPath + "/";
        const relativePath = found_path.startsWith(projectPrefix)
          ? found_path.slice(projectPrefix.length)
          : filename;
        action = "update_path";
        new_slot_path = relativePath;
        color = "green";
        break;
      }
      case "pool": {
        if (poolOption === "use_from_pool") {
          action = "update_path";
          // Compute relative path from project dir to found file in pool
          // e.g. project=/Set/Project, found=/Set/AUDIO/sub/file.wav → ../AUDIO/sub/file.wav
          const setDir = projectPath.substring(
            0,
            projectPath.lastIndexOf("/")
          );
          const setPrefix = setDir.endsWith("/") ? setDir : setDir + "/";
          const relFromSet = found_path.startsWith(setPrefix)
            ? found_path.slice(setPrefix.length)
            : `AUDIO/${filename}`;
          new_slot_path = `../${relFromSet}`;
          color = "green";
        } else {
          action = "copy_to_project";
          new_slot_path = filename;
          color = "blue";
        }
        break;
      }
      case "other_project": {
        if (otherProjectOption === "move_to_pool") {
          action = "move_to_pool";
          new_slot_path = `../AUDIO/${filename}`;
          color = "purple";
        } else {
          action = "copy_to_project";
          new_slot_path = filename;
          color = "blue";
        }
        break;
      }
      case "user_dir":
      default: {
        action = "copy_to_project";
        new_slot_path = filename;
        color = "blue";
        break;
      }
    }

    return {
      filename,
      found_path,
      source,
      source_project,
      action,
      new_slot_path,
      color,
    };
  }

  // Run all search steps sequentially
  useEffect(() => {
    let cancelled = false;

    async function runSearchSteps() {
      let remaining = [...missingSamples.map((s) => s.filename)];
      const allResolved: ResolvedFile[] = [];

      const MIN_STEP_MS = 400;

      async function withMinDuration<T>(promise: Promise<T>, startTime: number): Promise<T> {
        const result = await promise;
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_STEP_MS) {
          await new Promise((r) => setTimeout(r, MIN_STEP_MS - elapsed));
        }
        return result;
      }

      // Step 1: Project directory
      setSteps((prev) =>
        prev.map((s, i) => (i === 0 ? { ...s, status: "running" } : s))
      );
      try {
        const step1Start = Date.now();
        const found = await withMinDuration(
          invoke<FoundSample[]>("search_project_dir", {
            projectPath,
            filenames: remaining,
          }),
          step1Start
        );
        if (cancelled) return;

        for (const f of found) {
          const resolved = resolveAction(f.filename, f.found_path, "project");
          allResolved.push(resolved);
          remaining = remaining.filter((n) => n !== f.filename);
        }
        setSteps((prev) =>
          prev.map((s, i) =>
            i === 0 ? { ...s, status: "done", foundCount: found.length } : s
          )
        );
      } catch (err) {
        console.error("search_project_dir error:", err);
        setSteps((prev) =>
          prev.map((s, i) => (i === 0 ? { ...s, status: "done" } : s))
        );
      }

      // Step 2: Audio Pool
      if (remaining.length === 0 || !hasAudioPool) {
        setSteps((prev) =>
          prev.map((s, i) => (i === 1 ? { ...s, status: "skipped" } : s))
        );
      } else {
        setSteps((prev) =>
          prev.map((s, i) => (i === 1 ? { ...s, status: "running" } : s))
        );
        try {
          const step2Start = Date.now();
          const found = await withMinDuration(
            invoke<FoundSample[]>("search_audio_pool", {
              projectPath,
              filenames: remaining,
            }),
            step2Start
          );
          if (cancelled) return;

          for (const f of found) {
            const resolved = resolveAction(f.filename, f.found_path, "pool");
            allResolved.push(resolved);
            remaining = remaining.filter((n) => n !== f.filename);
          }
          setSteps((prev) =>
            prev.map((s, i) =>
              i === 1 ? { ...s, status: "done", foundCount: found.length } : s
            )
          );
        } catch (err) {
          console.error("search_audio_pool error:", err);
          setSteps((prev) =>
            prev.map((s, i) => (i === 1 ? { ...s, status: "done" } : s))
          );
        }
      }

      // Step 3: Other Set projects
      if (remaining.length === 0) {
        setSteps((prev) =>
          prev.map((s, i) => (i === 2 ? { ...s, status: "skipped" } : s))
        );
      } else {
        setSteps((prev) =>
          prev.map((s, i) => (i === 2 ? { ...s, status: "running" } : s))
        );
        try {
          const step3Start = Date.now();
          const found = await withMinDuration(
            invoke<FoundSample[]>("search_other_projects", {
              projectPath,
              filenames: remaining,
            }),
            step3Start
          );
          if (cancelled) return;

          for (const f of found) {
            const resolved = resolveAction(
              f.filename,
              f.found_path,
              "other_project",
              f.source_project || undefined
            );
            allResolved.push(resolved);
            remaining = remaining.filter((n) => n !== f.filename);
          }
          setSteps((prev) =>
            prev.map((s, i) =>
              i === 2
                ? { ...s, status: "done", foundCount: found.length }
                : s
            )
          );
        } catch (err) {
          console.error("search_other_projects error:", err);
          setSteps((prev) =>
            prev.map((s, i) => (i === 2 ? { ...s, status: "done" } : s))
          );
        }
      }

      if (cancelled) return;

      setResolvedFiles(allResolved);
      setRemainingFilenames(remaining);
      setPhase("search_done");
    }

    if (phase === "searching") {
      runSearchSteps();
    }

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browse directory
  async function handleBrowse() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select directory to search for missing samples",
      });
      if (!selected || typeof selected !== "string") return;

      // Warn if already searched
      if (searchedDirs.includes(selected)) {
        // Clear any pending timers
        dirWarningTimers.current.forEach(clearTimeout);
        dirWarningTimers.current = [];
        // Show warning, then fade out like Parts save indicator
        // Keep the end of the path (most useful to user), trim the beginning
        const parts = selected.split("/");
        let displayPath = selected;
        // Progressively remove leading segments until short enough
        while (displayPath.length > 35 && parts.length > 2) {
          parts.splice(1, 1);
          displayPath = parts[0] + "/…/" + parts.slice(1).join("/");
        }
        setDirWarning(`Already searched: ${displayPath}`);
        setDirWarningFading(false);
        dirWarningTimers.current.push(
          setTimeout(() => setDirWarningFading(true), 2000),
          setTimeout(() => { setDirWarning(""); setDirWarningFading(false); }, 3200),
        );
        return;
      }

      setDirWarning("");
      setSearchedDirs((prev) => [...prev, selected]);

      // Extract directory name for display
      const dirName = selected.split("/").filter(Boolean).pop() || selected;

      // Add a new step for this user-selected directory (running state)
      const stepIndex = steps.length;
      setSteps((prev) => [
        ...prev,
        { label: `User selection: ${dirName}`, status: "running", foundCount: 0, fullPath: selected },
      ]);

      // Search the directory
      const found = await invoke<FoundSample[]>("search_directory", {
        dirPath: selected,
        filenames: remainingFilenames,
      });

      const newResolved = [...resolvedFiles];
      let newRemaining = [...remainingFilenames];

      for (const f of found) {
        const resolved = resolveAction(f.filename, f.found_path, "user_dir");
        newResolved.push(resolved);
        newRemaining = newRemaining.filter((n) => n !== f.filename);
      }

      setResolvedFiles(newResolved);
      setRemainingFilenames(newRemaining);

      // Mark this step as done
      setSteps((prev) =>
        prev.map((s, i) => (i === stepIndex ? { ...s, status: "done", foundCount: found.length } : s))
      );
    } catch (err) {
      console.error("Browse error:", err);
    }
  }

  // Handle apply
  async function handleApply() {
    setPhase("applying");
    setApplyError("");

    try {
      // Back up all affected projects
      const projectsToBackup = new Set<string>();
      projectsToBackup.add(projectPath);
      for (const file of resolvedFiles) {
        if (file.action === "move_to_pool" && file.source_project) {
          // Need to find sibling project path
          const projectParent = projectPath.substring(0, projectPath.lastIndexOf("/"));
          projectsToBackup.add(`${projectParent}/${file.source_project}`);
        }
      }

      for (const p of projectsToBackup) {
        await invoke("backup_project_files", {
          projectPath: p,
          files: ["project.work"],
          label: "fix_missing_samples",
        });
      }

      // Apply fixes
      const resolutions: SampleResolution[] = resolvedFiles.map(buildResolution);
      const result = await invoke<FixResult>("fix_missing_samples", {
        projectPath,
        resolutions,
      });

      setFixResult(result);
      setPhase("done");
      onApplied();
    } catch (err) {
      setApplyError(String(err));
      setPhase("done");
    }
  }

  // Compute affected sibling projects for confirmation screen
  const affectedProjects: Map<string, ResolvedFile[]> = new Map();
  for (const file of resolvedFiles) {
    if (file.action === "move_to_pool" && file.source_project) {
      const existing = affectedProjects.get(file.source_project) || [];
      existing.push(file);
      affectedProjects.set(file.source_project, existing);
    }
  }

  const notFoundFilenames = missingSamples
    .map((s) => s.filename)
    .filter((f) => !resolvedFiles.some((r) => r.filename === f));

  // Build unified confirmation rows for sorting/filtering
  interface ConfirmRow {
    filename: string;
    found: boolean;
    location: string;
    actionLabel: string;
    actionTooltip: string;
    isNotFound: boolean;
    color?: string;
  }

  const allConfirmRows: ConfirmRow[] = [
    ...resolvedFiles.map((file): ConfirmRow => {
      const actionLabel =
        file.action === "update_path" && file.source === "pool" ? "Use from Pool" :
        file.action === "update_path" && file.source === "project" ? "Update path" :
        file.action === "copy_to_project" ? "Copy to project" :
        file.action === "move_to_pool" ? "Move to Pool" : "";
      const actionTooltip =
        file.action === "update_path" && file.source === "pool" ? "File exists in Audio Pool — update the slot path to reference it" :
        file.action === "update_path" && file.source === "project" ? "File found in project directory — update the slot path" :
        file.action === "copy_to_project" ? "File will be copied into the project directory" :
        file.action === "move_to_pool" ? "File will be moved to the Audio Pool and slot path updated" : "";
      return { filename: file.filename, found: true, location: file.found_path, actionLabel, actionTooltip, isNotFound: false, color: file.color };
    }),
    ...notFoundFilenames.map((f): ConfirmRow => ({
      filename: f, found: false, location: "—", actionLabel: "Not found", actionTooltip: "No matching file was found — this sample will remain missing", isNotFound: true,
    })),
  ];

  const filteredConfirmRows = allConfirmRows.filter((row) => {
    if (confirmSearchText && !row.filename.toLowerCase().includes(confirmSearchText.toLowerCase())) return false;
    if (foundFilter === "yes" && !row.found) return false;
    if (foundFilter === "no" && row.found) return false;
    if (actionFilter !== "all" && row.actionLabel !== actionFilter) return false;
    return true;
  });

  const sortedConfirmRows = [...filteredConfirmRows].sort((a, b) => {
    let cmpA: string | number;
    let cmpB: string | number;
    switch (confirmSortColumn) {
      case "file": cmpA = a.filename.toLowerCase(); cmpB = b.filename.toLowerCase(); break;
      case "found": cmpA = a.found ? 0 : 1; cmpB = b.found ? 0 : 1; break;
      case "location": cmpA = a.location.toLowerCase(); cmpB = b.location.toLowerCase(); break;
      case "action": cmpA = a.actionLabel.toLowerCase(); cmpB = b.actionLabel.toLowerCase(); break;
      default: return 0;
    }
    if (cmpA < cmpB) return confirmSortDirection === "asc" ? -1 : 1;
    if (cmpA > cmpB) return confirmSortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const uniqueActions = Array.from(new Set(allConfirmRows.map((r) => r.actionLabel))).sort();

  const hasConfirmActiveFilters = foundFilter !== "all" || actionFilter !== "all";

  const renderConfirmFilterableHeader = (
    column: ConfirmSortColumn,
    label: string,
    filterName: string,
    isActive: boolean,
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void,
    extraStyle?: React.CSSProperties,
    resizeIndex?: number,
  ) => (
    <th className="filterable-header" style={{ ...extraStyle, position: 'relative' }}>
      <div className="header-content">
        <span onClick={() => handleConfirmSort(column)} className="sortable-label">
          {label} {confirmSortColumn === column && (confirmSortDirection === "asc" ? "▲" : "▼")}
        </span>
        <button
          className={`filter-icon ${confirmOpenDropdown === filterName || isActive ? "active" : ""}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (confirmOpenDropdown === filterName) {
              closeConfirmDropdown();
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setConfirmDropdownPosition({ top: rect.bottom + 4, left: rect.right - 120 });
              setConfirmOpenDropdown(filterName);
            }
          }}
        >
          ⋮
        </button>
      </div>
      {confirmOpenDropdown === filterName && confirmDropdownPosition && (
        <div className="filter-dropdown" style={{ position: "fixed", top: confirmDropdownPosition.top, left: confirmDropdownPosition.left, width: "auto", minWidth: "auto" }}>
          <div className="dropdown-options" style={{ width: "max-content" }}>
            {options.map((opt) => (
              <label key={opt.value} className="dropdown-option">
                <input type="radio" name={`${filterName}-confirm-filter`} checked={currentValue === opt.value} onChange={() => { onChange(opt.value); closeConfirmDropdown(); }} />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {resizeIndex !== undefined && (
        <span className="col-resize-handle" onMouseDown={(e) => handleColResizeMouseDown(resizeIndex, e)} />
      )}
    </th>
  );

  return (
    <div className="modal-overlay" onClick={phase === "done" || phase === "search_done" || phase === "confirming" ? onClose : undefined}>
      <div
        ref={modalRef}
        className="modal-content fix-missing-modal"
        onClick={(e) => e.stopPropagation()}
        style={modalWidth ? { width: modalWidth, maxWidth: "95vw" } : undefined}
      >
        {/* Resize handles */}
        <div
          className="modal-resize-handle modal-resize-left"
          onMouseDown={(e) => handleModalResizeMouseDown("left", e)}
        />
        <div
          className="modal-resize-handle modal-resize-right"
          onMouseDown={(e) => handleModalResizeMouseDown("right", e)}
        />
        <div
          className="modal-resize-handle modal-resize-bottom"
          onMouseDown={(e) => handleModalResizeMouseDown("bottom", e)}
        />
        <div className={`modal-header${phase === "confirming" ? " missing-samples-header" : ""}`}>
          <h3>
            {(phase === "searching" || phase === "search_done" || phase === "applying" || phase === "done") && (applyError ? "Error" : "Searching for missing samples...")}
            {phase === "confirming" && <><i className="fas fa-clipboard-check"></i> Review planned changes</>}
          </h3>
          {dirWarning && (
            <div className={`fix-dir-warning${dirWarningFading ? " fading" : ""}`}><i className="fas fa-exclamation-triangle"></i> {dirWarning}</div>
          )}
          {phase === "confirming" && (
            <>
              <div className="missing-samples-header-info">
                <span className={`fix-confirm-status${resolvedFiles.length === allConfirmRows.length ? " all-resolved" : ""}`}>
                  <strong>{resolvedFiles.length}/{allConfirmRows.length}</strong> missing files found
                  {sortedConfirmRows.length !== allConfirmRows.length && <span style={{ color: 'var(--elektron-text-secondary)', fontWeight: 400 }}> — showing {sortedConfirmRows.length}</span>}
                </span>
                {foundFilter !== "all" && <span className="filter-badge">Found: {foundFilter === "yes" ? "Yes" : "No"}</span>}
                {actionFilter !== "all" && <span className="filter-badge">Action: {actionFilter}</span>}
                {hasConfirmActiveFilters && (
                  <button className="reset-filters-btn" onClick={() => { setFoundFilter("all"); setActionFilter("all"); }} title="Reset all filters">✕ Reset</button>
                )}
              </div>
              <div className="missing-samples-header-actions">
                <div className="header-search-container">
                  <input type="text" placeholder="Search..." value={confirmSearchText} onChange={(e) => setConfirmSearchText(e.target.value)} className="header-search-input" />
                  {confirmSearchText && (
                    <button className="header-search-clear" onClick={() => setConfirmSearchText("")} title="Clear search">×</button>
                  )}
                </div>
                <button
                  className={`copy-table-btn ${copyFeedback === "copied" ? "copied" : ""}`}
                  onClick={copyConfirmTableToClipboard}
                  title="Copy table to clipboard (for Excel/Google Sheets)"
                >
                  {copyFeedback === "copied" ? "✓" : "⧉"}
                </button>
              </div>
            </>
          )}
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className={`modal-body ${phase === "confirming" || phase === "searching" || phase === "search_done" || phase === "applying" || phase === "done" ? "fix-confirm-body" : ""}`}>
          {/* PROGRESS SECTION — visible during searching, search_done, applying, and done */}
          {(phase === "searching" || phase === "search_done" || phase === "applying" || phase === "done") && (
            <div className="fix-progress-section">
              <div className="fix-search-steps">
                {steps.map((step, i) => {
                  const baseTooltips = [
                    "Search for missing files within the project directory and subdirectories",
                    "Search the shared Audio Pool directory (../AUDIO/) for matching files",
                    "Search other projects within the same Set for matching files",
                  ];
                  const skippedTooltips = [
                    "Skipped",
                    hasAudioPool ? "All missing files were already found in previous steps" : "No Audio Pool directory found for this Set",
                    "All missing files were already found in previous steps",
                  ];
                  const tooltip = step.fullPath
                    ? step.fullPath
                    : step.status === "skipped"
                      ? skippedTooltips[i] ?? "Skipped"
                      : baseTooltips[i] ?? "";
                  return (
                    <div key={i} className={`fix-search-step ${step.status}`} title={tooltip}>
                      <span className="fix-step-icon">
                        {step.status === "running" && <span className="loading-spinner-small"></span>}
                        {step.status === "done" && <i className="fas fa-check"></i>}
                        {step.status === "skipped" && <i className="fas fa-minus"></i>}
                        {step.status === "pending" && <i className="fas fa-minus"></i>}
                      </span>
                      <span className="fix-step-label">
                        {step.fullPath ? <>User selection: <span className="fix-step-dirname" title={step.fullPath}>{step.label.replace("User selection: ", "")}</span></> : step.label}
                      </span>
                      {step.status === "done" && step.foundCount > 0 && (
                        <span className="fix-step-count">{step.foundCount} found</span>
                      )}
                      {step.status === "done" && step.foundCount === 0 && (
                        <span className="fix-step-count">0 found</span>
                      )}
                      {step.status === "skipped" && (
                        <span className="fix-step-count">skipped</span>
                      )}
                    </div>
                  );
                })}

                {/* Apply step — visible during applying and done */}
                {(phase === "applying" || phase === "done") && (
                  <div className={`fix-search-step ${phase === "applying" ? "running" : "done"}`}>
                    <span className="fix-step-icon">
                      {phase === "applying" && <span className="loading-spinner-small"></span>}
                      {phase === "done" && !applyError && <i className="fas fa-check"></i>}
                      {phase === "done" && applyError && <i className="fas fa-exclamation-circle" style={{ color: '#e74c3c' }}></i>}
                    </span>
                    <span className="fix-step-label">
                      {phase === "applying" ? "Applying changes..." : applyError ? "Error applying changes" : `${fixResult?.resolved_count ?? 0} samples resolved`}
                    </span>
                  </div>
                )}
              </div>

              {/* Summary line — always visible, updates live */}
              <div className={`fix-search-summary${resolvedFiles.length === initialMissingCount.current && phase !== "searching" ? " all-resolved" : ""}`} title={`${resolvedFiles.length} of ${initialMissingCount.current} missing sample files were located across searched locations`}>
                <span>
                  <strong>{resolvedFiles.length}/{initialMissingCount.current}</strong> missing files found
                  {phase !== "searching" && remainingFilenames.length > 0 && (
                    <span className="fix-search-summary-remaining"> — {remainingFilenames.length} still missing</span>
                  )}
                </span>
                {phase === "search_done" && remainingFilenames.length > 0 && (
                  <button
                    className="tools-execute-btn"
                    onClick={handleBrowse}
                    title="Browse for a directory to search for remaining missing files"
                  >
                    <i className="fas fa-folder-open"></i> Browse...
                  </button>
                )}
              </div>

              {/* Error detail */}
              {phase === "done" && applyError && (
                <div className="fix-done-error">
                  <i className="fas fa-exclamation-circle"></i>
                  <p>{applyError}</p>
                </div>
              )}

              {/* Buttons — always visible, disabled during search/apply */}
              {phase !== "done" && !skipReview && (
                <div className="fix-done-actions">
                  <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button
                    className="tools-execute-btn"
                    onClick={() => setPhase("confirming")}
                    title="Review the list of changes before applying them to the project"
                    disabled={phase === "searching" || phase === "applying"}
                  >
                    Review changes
                  </button>
                </div>
              )}

              {/* Done button after apply */}
              {phase === "done" && (
                <div className="fix-done-actions">
                  <button className="tools-execute-btn" onClick={onClose} title="Close this dialog">
                    Done
                  </button>
                </div>
              )}
            </div>
          )}

          {/* browse_prompt phase removed — Browse button is now inline in progress section */}

          {/* CONFIRMATION PHASE */}
          {phase === "confirming" && (
            <div className="fix-confirmation">
              {/* Unified table: resolved + not found */}
              <div className="fix-confirm-table-wrapper">
                <table className="samples-table" ref={tableRef}>
                  <colgroup>
                    {colWidths.length > 0
                      ? colWidths.map((w, i) => <col key={i} style={{ width: w }} />)
                      : <><col /><col /><col /><col /></>
                    }
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => handleConfirmSort("file")} style={{ position: 'relative' }}>
                        File {confirmSortColumn === "file" && (confirmSortDirection === "asc" ? "▲" : "▼")}
                        <span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); handleColResizeMouseDown(0, e); }} />
                      </th>
                      {renderConfirmFilterableHeader(
                        "found", "Found", "found", foundFilter !== "all",
                        [{ value: "all", label: "All" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }],
                        foundFilter, setFoundFilter, { textAlign: 'center' }, 1
                      )}
                      <th className="sortable" onClick={() => handleConfirmSort("location")} style={{ position: 'relative' }}>
                        Location {confirmSortColumn === "location" && (confirmSortDirection === "asc" ? "▲" : "▼")}
                        <span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); handleColResizeMouseDown(2, e); }} />
                      </th>
                      {renderConfirmFilterableHeader(
                        "action", "Action", "action", actionFilter !== "all",
                        [{ value: "all", label: "All" }, ...uniqueActions.map((a) => ({ value: a, label: a }))],
                        actionFilter, setActionFilter, undefined, undefined
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedConfirmRows.map((row) => (
                      <tr key={row.filename} className={row.isNotFound ? "fix-notfound-row" : ""}>
                        <td className="col-sample" title={row.filename}>{row.filename}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`file-status-badge ${row.found ? "file-exists" : "file-missing"}`} title={row.found ? "File was found and will be resolved" : "File could not be found in any searched location"}>
                            {row.found ? "✓" : "✗"}
                          </span>
                        </td>
                        <td className="fix-location-cell" title={row.location}>{row.location}</td>
                        <td className={row.isNotFound ? "fix-notfound-cell" : ""} title={row.actionTooltip}>{row.actionLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Affected sibling projects */}
              {affectedProjects.size > 0 && (
                <div className="fix-confirm-affected">
                  <div className="fix-confirm-affected-header">
                    <i className="fas fa-exclamation-triangle"></i> Other projects affected by "Move to Pool"
                  </div>
                  {Array.from(affectedProjects.entries()).map(([project, files]) => (
                    <div key={project} className="fix-confirm-affected-project">
                      <div className="fix-confirm-affected-name">{project}</div>
                      {files.map((f) => (
                        <div key={f.filename} className="fix-confirm-affected-change">
                          {f.filename} &rarr; ../AUDIO/{f.filename}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="fix-confirm-actions">
                <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">{resolvedFiles.length > 0 ? "Cancel" : "Close"}</button>
                <button className="fix-cancel-btn" onClick={() => setPhase("search_done")} title="Go back to the search results">
                  Previous
                </button>
                <div style={{ flex: 1 }} />
                {resolvedFiles.length > 0 && (
                  <button className="tools-execute-btn" onClick={handleApply}>
                    Apply Changes
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
