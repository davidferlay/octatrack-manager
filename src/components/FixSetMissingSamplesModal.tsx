import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { HeaderActions, useCopyFeedback, useModalResize } from "./FixPoolFilesModal";
import { useEscapeClose } from "../hooks/useEscapeClose";
import {
  resolveFoundSample,
  type MissingSample,
  type FoundSample,
  type ResolvedFile,
  type SampleResolution,
  type FixResult,
  type PoolOption,
  type OtherProjectOption,
} from "./FixMissingSamplesModal";

/** One project of the Set, with what its sample slots are missing. */
export interface ProjectMissing {
  name: string;
  path: string;
  missing: MissingSample[];
}

type Phase = "searching" | "search_done" | "confirming" | "applying" | "done";

type SortCol = "project" | "file" | "location" | "action";

interface StepState {
  label: string;
  status: "pending" | "running" | "done";
  foundCount: number;
  /** Set for a user-selected directory step, shown in the tooltip. */
  fullPath?: string;
}

interface Props {
  /** Projects that actually have missing samples; projects with none are not passed. */
  projects: ProjectMissing[];
  poolOption: PoolOption;
  otherProjectOption: OtherProjectOption;
  /** Apply as soon as the search finishes, without the review screen. */
  skipReview: boolean;
  onClose: () => void;
  onApplied: () => void;
}

/** A review row: one missing file in one project, resolved or not. */
interface Row {
  project: string;
  filename: string;
  location: string;
  action: string;
  actionTitle: string;
  found: boolean;
  color?: string;
}

const ACTION_LABELS: Record<string, string> = {
  update_path: "Update path",
  copy_to_project: "Copy to project",
  move_to_pool: "Move to Pool",
};

const ACTION_TITLES: Record<string, string> = {
  update_path: "The file exists where the project can reach it - only the slot path changes",
  copy_to_project: "The file will be copied into the project directory",
  move_to_pool: "The file will be moved to the Audio Pool and every slot referencing it updated",
};

/**
 * Fix Missing Samples across every project of a Set in one pass.
 *
 * The backend commands are all project-scoped, so this walks the projects once per
 * search location rather than once per project - three passes over the Set instead
 * of opening the per-project tool N times. Resolutions stay keyed by project: the
 * same filename missing in two projects is two independent rows, since where it is
 * copied to (or what its slot path becomes) differs per project.
 */
export function FixSetMissingSamplesModal({
  projects, poolOption, otherProjectOption, skipReview, onClose, onApplied,
}: Props) {
  const [phase, setPhase] = useState<Phase>("searching");
  const [steps, setSteps] = useState<StepState[]>([
    { label: "Project directories", status: "pending", foundCount: 0 },
    { label: "Audio Pool", status: "pending", foundCount: 0 },
    { label: "Other projects of Set", status: "pending", foundCount: 0 },
  ]);
  const [scanningProject, setScanningProject] = useState("");
  // Resolutions and still-missing filenames, both keyed by project path.
  const [resolved, setResolved] = useState<Map<string, ResolvedFile[]>>(new Map());
  const [remaining, setRemaining] = useState<Map<string, string[]>>(new Map());
  const [searchedDirs, setSearchedDirs] = useState<string[]>([]);
  const [result, setResult] = useState<{ fixes: FixResult[]; failures: string[] } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("project");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [projectFilter, setProjectFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [openDropdown, setOpenDropdown] = useState<SortCol | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [copyFeedback, copy] = useCopyFeedback();
  const { modalRef, style, handles } = useModalResize();
  const appliedRef = useRef(false);
  // Escape dismisses, except while the search or the apply pass is running -
  // the same states that hide the close button.
  useEscapeClose(onClose, phase !== "searching" && phase !== "applying");

  useEffect(() => {
    if (!openDropdown) return;
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest(".filter-dropdown") && !t.closest(".filter-icon")) setOpenDropdown(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openDropdown]);

  const updateStep = (label: string, patch: Partial<StepState>) =>
    setSteps(prev => prev.map(s => (s.label === label ? { ...s, ...patch } : s)));

  useEffect(() => {
    let cancelled = false;
    const found = new Map<string, ResolvedFile[]>(projects.map(p => [p.path, []]));
    const left = new Map<string, string[]>(projects.map(p => [p.path, p.missing.map(m => m.filename)]));

    async function runStep(label: string, command: string, source: string) {
      updateStep(label, { status: "running" });
      let hits = 0;
      for (const p of projects) {
        const filenames = left.get(p.path) ?? [];
        if (filenames.length === 0) continue;
        setScanningProject(p.name);
        try {
          const results = await invoke<FoundSample[]>(command, { projectPath: p.path, filenames });
          if (cancelled) return;
          for (const f of results) {
            const still = left.get(p.path) ?? [];
            // A location can return the same name twice (two subfolders); first wins.
            if (!still.includes(f.filename)) continue;
            found.get(p.path)!.push(resolveFoundSample(
              p.path, poolOption, otherProjectOption,
              f.filename, f.found_path, source, f.source_project ?? undefined,
            ));
            left.set(p.path, still.filter(n => n !== f.filename));
            hits++;
          }
        } catch (err) {
          console.error(`${label} search failed for ${p.name}:`, err);
        }
      }
      updateStep(label, { status: "done", foundCount: hits });
    }

    (async () => {
      await runStep("Project directories", "search_project_dir", "project");
      if (cancelled) return;
      await runStep("Audio Pool", "search_audio_pool", "pool");
      if (cancelled) return;
      await runStep("Other projects of Set", "search_other_projects_of_set", "other_project");
      if (cancelled) return;
      setScanningProject("");
      setResolved(new Map(found));
      setRemaining(new Map(left));
      setPhase(skipReview ? "applying" : "search_done");
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search one more directory, across every project that still needs something.
  async function handleBrowse() {
    const selected = await open({ directory: true, multiple: false, title: "Select directory to search for missing samples" });
    if (typeof selected !== "string") return;
    const wanted = Array.from(new Set([...remaining.values()].flat()));
    if (wanted.length === 0) return;
    // One scan of that directory serves every project - it is not project-relative.
    const dirName = selected.split(/[\\/]/).filter(Boolean).pop() || selected;
    setSteps(prev => [...prev, { label: `User selection: ${dirName}`, status: "running", foundCount: 0, fullPath: selected }]);
    const hits = await invoke<FoundSample[]>("search_directory", { dirPath: selected, filenames: wanted }).catch(() => []);
    setSearchedDirs(prev => [...prev, selected]);
    setSteps(prev => prev.map(st => (st.fullPath === selected ? { ...st, status: "done", foundCount: hits.length } : st)));
    if (hits.length === 0) return;
    const nextResolved = new Map(resolved);
    const nextRemaining = new Map(remaining);
    for (const p of projects) {
      const still = nextRemaining.get(p.path) ?? [];
      const useful = hits.filter(h => still.includes(h.filename));
      if (useful.length === 0) continue;
      nextResolved.set(p.path, [
        ...(nextResolved.get(p.path) ?? []),
        ...useful.map(h => resolveFoundSample(p.path, poolOption, otherProjectOption, h.filename, h.found_path, "user_dir")),
      ]);
      nextRemaining.set(p.path, still.filter(n => !useful.some(h => h.filename === n)));
    }
    setResolved(nextResolved);
    setRemaining(nextRemaining);
  }

  useEffect(() => {
    if (phase !== "applying" || appliedRef.current) return;
    appliedRef.current = true;
    (async () => {
      const fixes: FixResult[] = [];
      const failures: string[] = [];
      for (const p of projects) {
        const files = resolved.get(p.path) ?? [];
        if (files.length === 0) continue;
        try {
          // Back up this project, plus any sibling a move_to_pool will repoint.
          const setDir = p.path.substring(0, p.path.lastIndexOf("/"));
          const toBackup = new Set<string>([p.path]);
          for (const f of files) {
            if (f.action === "move_to_pool" && f.source_project) toBackup.add(`${setDir}/${f.source_project}`);
          }
          for (const dir of toBackup) {
            await invoke("backup_project_files", { projectPath: dir, files: ["project.work"], label: "fix_missing_samples" });
          }
          const resolutions: SampleResolution[] = files.map(f => ({
            filename: f.filename, found_path: f.found_path, action: f.action, new_slot_path: f.new_slot_path,
          }));
          fixes.push(await invoke<FixResult>("fix_missing_samples", { projectPath: p.path, resolutions }));
        } catch (err) {
          failures.push(`${p.name}: ${String(err)}`);
        }
      }
      setResult({ fixes, failures });
      setPhase("done");
      onApplied();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const rows: Row[] = projects.flatMap(p => [
    ...(resolved.get(p.path) ?? []).map((f): Row => ({
      project: p.name,
      filename: f.filename,
      location: f.found_path,
      action: ACTION_LABELS[f.action] ?? f.action,
      actionTitle: ACTION_TITLES[f.action] ?? "",
      found: true,
      color: f.color,
    })),
    ...(remaining.get(p.path) ?? []).map((filename): Row => ({
      project: p.name,
      filename,
      location: "—",
      action: "Not found",
      actionTitle: "No matching file was found anywhere - this slot stays missing",
      found: false,
    })),
  ]);

  const visibleRows = rows
    .filter(r => {
      if (searchText && !`${r.project} ${r.filename} ${r.location}`.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (projectFilter !== "all" && r.project !== projectFilter) return false;
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const key = (r: Row) => (
        sortCol === "project" ? r.project.toLowerCase()
          : sortCol === "file" ? r.filename.toLowerCase()
            : sortCol === "location" ? r.location.toLowerCase()
              : r.action.toLowerCase()
      );
      const [ka, kb] = [key(a), key(b)];
      const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

  const hasFilters = projectFilter !== "all" || actionFilter !== "all";
  const uniqueActions = Array.from(new Set(rows.map(r => r.action))).sort();

  const sortBy = (col: SortCol) => {
    if (sortCol === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  /** Sortable label plus, when options are given, the same kebab filter the other review tables use. */
  const header = (col: SortCol, label: string, options?: { value: string; label: string }[], current?: string, onPick?: (v: string) => void) => (
    <th className={options ? "filterable-header" : "sortable"} style={{ position: "relative" }} onClick={options ? undefined : () => sortBy(col)}>
      {options ? (
        <div className="header-content">
          <span className="sortable-label" onClick={() => sortBy(col)}>
            {label}{sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
          </span>
          <button
            className={`filter-icon ${openDropdown === col || current !== "all" ? "active" : ""}`}
            onMouseDown={e => {
              e.stopPropagation();
              e.preventDefault();
              if (openDropdown === col) { setOpenDropdown(null); return; }
              const rect = e.currentTarget.getBoundingClientRect();
              setDropdownPos({ top: rect.bottom + 4, left: rect.right - 120 });
              setOpenDropdown(col);
            }}
          >
            ⋮
          </button>
        </div>
      ) : (
        <>{label}{sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</>
      )}
      {options && openDropdown === col && dropdownPos && (
        <div className="filter-dropdown" style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: "auto", minWidth: "auto" }}>
          <div className="dropdown-options" style={{ width: "max-content" }}>
            {options.map(opt => (
              <label key={opt.value} className="dropdown-option">
                <input
                  type="radio"
                  name={`${col}-set-missing-filter`}
                  checked={current === opt.value}
                  onChange={() => { onPick?.(opt.value); setOpenDropdown(null); }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </th>
  );
  const notFoundCount = rows.filter(r => !r.found).length;
  const totalMissing = projects.reduce((n, p) => n + p.missing.length, 0);
  const resolvedTotal = rows.length - notFoundCount;

  const tsv = [
    ["Project", "File", "Found in", "Action"].join("\t"),
    ...visibleRows.map(r => [r.project, r.filename, r.location, r.action].join("\t")),
  ].join("\n");

  const progressPhase = phase !== "confirming";
  const busy = phase === "searching" || phase === "applying";

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div
        ref={modalRef}
        className={`modal-content fix-missing-modal fix-set-missing-modal${phase === "confirming" ? "" : " fix-pool-modal-narrow"}`}
        onClick={e => e.stopPropagation()}
        style={style}
      >
        {handles}
        <div className={`modal-header${phase === "confirming" ? " missing-samples-header" : ""}`}>
          <h3>
            {progressPhase && "Searching for missing samples across Set..."}
            {phase === "confirming" && <><i className="fas fa-clipboard-check"></i> Review planned changes</>}
          </h3>
          {phase === "confirming" && (
            <>
              <div className="missing-samples-header-info">
                <span className={`fix-confirm-status${notFoundCount === 0 ? " all-resolved" : ""}`}>
                  <strong>{resolvedTotal}/{totalMissing}</strong> missing files found across {projects.length} project{projects.length === 1 ? "" : "s"}
                  {visibleRows.length !== rows.length && (
                    <span style={{ color: "var(--elektron-text-secondary)", fontWeight: 400 }}> - showing {visibleRows.length}</span>
                  )}
                </span>
                {projectFilter !== "all" && <span className="filter-badge">Project: {projectFilter}</span>}
                {actionFilter !== "all" && <span className="filter-badge">Action: {actionFilter}</span>}
                {hasFilters && (
                  <button className="reset-filters-btn" onClick={() => { setProjectFilter("all"); setActionFilter("all"); }} title="Reset all filters">
                    ✕ Reset
                  </button>
                )}
              </div>
              <HeaderActions
                searchText={searchText}
                setSearchText={setSearchText}
                onCopy={() => copy(tsv)}
                copyFeedback={copyFeedback}
              />
            </>
          )}
          {!busy && <button className="modal-close" onClick={onClose}>&times;</button>}
        </div>

        <div className="modal-body fix-confirm-body">
          {progressPhase && (
            <div className="fix-progress-section">
              <div className="fix-search-steps">
                {steps.map((step, i) => (
                  <div key={i} className={`fix-search-step ${step.status}`} title={step.fullPath ?? ""}>
                    <span className="fix-step-icon">
                      {step.status === "running" && <span className="loading-spinner-small"></span>}
                      {step.status === "done" && <i className="fas fa-check"></i>}
                      {step.status === "pending" && <i className="fas fa-minus"></i>}
                    </span>
                    <span className="fix-step-label">
                      {step.fullPath
                        ? <>User selection: <span className="fix-step-dirname" title={step.fullPath}>{step.label.replace("User selection: ", "")}</span></>
                        : step.label}
                      {step.status === "running" && scanningProject && <span className="fix-step-dirname"> {scanningProject}</span>}
                    </span>
                    {step.status === "done" && <span className="fix-step-count">{step.foundCount} found</span>}
                  </div>
                ))}

                {(phase === "applying" || phase === "done") && (
                  <div className={`fix-search-step ${phase === "applying" ? "running" : "done"}`}>
                    <span className="fix-step-icon">
                      {phase === "applying" && <span className="loading-spinner-small"></span>}
                      {phase === "done" && (result?.failures.length
                        ? <i className="fas fa-exclamation-circle" style={{ color: "#e74c3c" }}></i>
                        : <i className="fas fa-check"></i>)}
                    </span>
                    <span className="fix-step-label">
                      {phase === "applying"
                        ? `Applying across ${projects.length} project${projects.length === 1 ? "" : "s"}...`
                        : `${result?.fixes.reduce((n, r) => n + r.resolved_count, 0) ?? 0} samples resolved in ${result?.fixes.length ?? 0} project${(result?.fixes.length ?? 0) === 1 ? "" : "s"}`}
                    </span>
                  </div>
                )}
              </div>

              <div className={`fix-search-summary${notFoundCount === 0 && phase !== "searching" ? " all-resolved" : ""}`}>
                <span>
                  <strong>{resolvedTotal}/{totalMissing}</strong> missing files found
                  {phase !== "searching" && notFoundCount > 0 && (
                    <span className="fix-search-summary-remaining"> - {notFoundCount} still missing</span>
                  )}
                </span>
                {phase === "search_done" && notFoundCount > 0 && (
                  <button
                    className="tools-execute-btn"
                    onClick={handleBrowse}
                    title={searchedDirs.length > 0
                      ? `Browse another directory - already searched:\n${searchedDirs.join("\n")}`
                      : "Browse for a directory to search for the remaining missing files"}
                  >
                    <i className="fas fa-folder-open"></i> Browse...
                  </button>
                )}
              </div>

              {result && result.failures.length > 0 && (
                <div className="fix-done-error">
                  <i className="fas fa-exclamation-circle"></i>
                  <p>{result.failures.join("\n")}</p>
                </div>
              )}

              {phase !== "done" && !skipReview && (
                <div className="fix-done-actions">
                  <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">Cancel</button>
                  <div style={{ flex: 1 }} />
                  <button
                    className="tools-execute-btn"
                    onClick={() => setPhase("confirming")}
                    title="Review the list of changes before applying them"
                    disabled={phase === "searching" || phase === "applying"}
                  >
                    Review changes
                  </button>
                </div>
              )}

              {phase === "done" && (
                <div className="fix-done-actions">
                  <button className="tools-execute-btn" onClick={onClose} title="Close this dialog">Done</button>
                </div>
              )}
            </div>
          )}

          {phase === "confirming" && (
            <div className="fix-confirmation">
              <div className="fix-confirm-table-wrapper">
                <table className="samples-table">
                  <thead>
                    <tr>
                      {header("project", "Project",
                        [{ value: "all", label: "All" }, ...projects.map(p => ({ value: p.name, label: p.name }))],
                        projectFilter, setProjectFilter)}
                      {header("file", "File")}
                      {header("location", "Location")}
                      {header("action", "Action",
                        [{ value: "all", label: "All" }, ...uniqueActions.map(a => ({ value: a, label: a }))],
                        actionFilter, setActionFilter)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r, i) => (
                      <tr key={`${r.project}-${r.filename}-${i}`} className={r.found ? "" : "fix-notfound-row"}>
                        <td>{r.project}</td>
                        <td className="col-sample">{r.filename}</td>
                        <td className="fix-location-cell" title={r.location}>{r.location}</td>
                        <td className={r.found ? "" : "fix-notfound-cell"} title={r.actionTitle}>{r.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="fix-confirm-actions">
                <button className="fix-cancel-btn" onClick={onClose} title="Close without applying any changes">
                  {resolvedTotal > 0 ? "Cancel" : "Close"}
                </button>
                <button className="fix-cancel-btn" onClick={() => setPhase("search_done")} title="Go back to the search results">
                  Previous
                </button>
                <div style={{ flex: 1 }} />
                {resolvedTotal > 0 && (
                  <button className="tools-execute-btn" onClick={() => setPhase("applying")}>
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
