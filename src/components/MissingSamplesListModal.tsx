import { useState, useEffect, useRef, useCallback } from "react";

interface MissingSample {
  filename: string;
  original_path: string;
  slot_type: string;
  flex_slot_ids: number[];
  static_slot_ids: number[];
}

// Flattened row: one per (slot_id, slot_type, filename)
interface MissingSampleRow {
  slot_id: number;
  slot_type: "Flex" | "Static";
  filename: string;
  original_path: string;
  source: string; // "Project" or "Audio Pool"
}

interface MissingSamplesListModalProps {
  missingSamples: MissingSample[];
  onClose: () => void;
}

type SortColumn = "slot" | "file" | "source" | "type";
type SortDirection = "asc" | "desc";

// Derive source location from path, same logic as backend
function getSource(path: string): string {
  if (
    path.includes("/AUDIO/") ||
    path.includes("\\AUDIO\\") ||
    path.startsWith("AUDIO/") ||
    path.startsWith("AUDIO\\") ||
    path.startsWith("../AUDIO/")
  ) {
    return "Audio Pool";
  }
  return "Project";
}

export function MissingSamplesListModal({
  missingSamples,
  onClose,
}: MissingSamplesListModalProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("slot");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied">("idle");
  const [modalWidth, setModalWidth] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef<"left" | "right" | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Flatten MissingSample[] into one row per slot
  const rows: MissingSampleRow[] = [];
  for (const sample of missingSamples) {
    const source = getSource(sample.original_path);
    for (const id of sample.flex_slot_ids) {
      rows.push({
        slot_id: id,
        slot_type: "Flex",
        filename: sample.filename,
        original_path: sample.original_path,
        source,
      });
    }
    for (const id of sample.static_slot_ids) {
      rows.push({
        slot_id: id,
        slot_type: "Static",
        filename: sample.filename,
        original_path: sample.original_path,
        source,
      });
    }
  }

  const closeDropdown = () => {
    setOpenDropdown(null);
    setDropdownPosition(null);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!openDropdown) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (
        !target.closest(".filter-dropdown") &&
        !target.closest(".filter-icon")
      ) {
        setOpenDropdown(null);
        setDropdownPosition(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdown]);

  // Resize drag handlers
  const handleResizeMouseDown = useCallback(
    (side: "left" | "right", e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = side;
      dragStartX.current = e.clientX;
      dragStartWidth.current =
        modalRef.current?.getBoundingClientRect().width ?? 700;
    },
    []
  );

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      // Both edges expand symmetrically: multiply delta by 2
      const multiplier = isDragging.current === "right" ? 2 : -2;
      const newWidth = Math.max(
        400,
        Math.min(window.innerWidth * 0.95, dragStartWidth.current + delta * multiplier)
      );
      setModalWidth(newWidth);
    }
    function handleMouseUp() {
      isDragging.current = null;
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const filterRows = (rowsToFilter: MissingSampleRow[]) => {
    return rowsToFilter.filter((row) => {
      if (searchText) {
        if (!row.filename.toLowerCase().includes(searchText.toLowerCase())) {
          return false;
        }
      }
      if (typeFilter !== "all") {
        if (row.slot_type !== typeFilter) return false;
      }
      if (sourceFilter !== "all") {
        if (row.source !== sourceFilter) return false;
      }
      return true;
    });
  };

  const sortRows = (rowsToSort: MissingSampleRow[]) => {
    return [...rowsToSort].sort((a, b) => {
      let compareA: string | number;
      let compareB: string | number;

      switch (sortColumn) {
        case "slot":
          compareA = (a.slot_type === "Flex" ? 0 : 1000) + a.slot_id;
          compareB = (b.slot_type === "Flex" ? 0 : 1000) + b.slot_id;
          break;
        case "file":
          compareA = a.filename.toLowerCase();
          compareB = b.filename.toLowerCase();
          break;
        case "source":
          compareA = a.source;
          compareB = b.source;
          break;
        case "type":
          compareA = a.slot_type;
          compareB = b.slot_type;
          break;
        default:
          return 0;
      }

      if (compareA < compareB) return sortDirection === "asc" ? -1 : 1;
      if (compareA > compareB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  };

  const filteredRows = filterRows(rows);
  const sortedRows = sortRows(filteredRows);

  const hasActiveFilters = typeFilter !== "all" || sourceFilter !== "all";

  const resetAllFilters = () => {
    setTypeFilter("all");
    setSourceFilter("all");
  };

  const getUniqueSources = () => {
    const sources = new Set<string>();
    rows.forEach((row) => sources.add(row.source));
    return Array.from(sources).sort();
  };

  const copyTableToClipboard = async () => {
    const headers = ["Slot", "File", "Source", "Type"];
    const tsvRows = sortedRows.map(
      (row) =>
        `${row.slot_type === "Flex" ? "F" : "S"}${row.slot_id}\t${row.filename}\t${row.source}\t${row.slot_type}`
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

  const renderFilterableHeader = (
    column: SortColumn,
    label: string,
    filterName: string,
    isActive: boolean,
    colClass: string,
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void
  ) => (
    <th className={`filterable-header ${colClass}`}>
      <div className="header-content">
        <span className="sort-indicator" onClick={() => handleSort(column)}>
          {sortColumn === column && (sortDirection === "asc" ? "▲" : "▼")}
        </span>
        <span onClick={() => handleSort(column)} className="sortable-label">
          {label}
        </span>
        <button
          className={`filter-icon ${openDropdown === filterName || isActive ? "active" : ""}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (openDropdown === filterName) {
              closeDropdown();
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              setDropdownPosition({
                top: rect.bottom + 4,
                left: rect.right - 120,
              });
              setOpenDropdown(filterName);
            }
          }}
        >
          ⋮
        </button>
      </div>
      {openDropdown === filterName && dropdownPosition && (
        <div
          className="filter-dropdown"
          style={{
            position: "fixed",
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: "auto",
            minWidth: "auto",
          }}
        >
          <div className="dropdown-options" style={{ width: "max-content" }}>
            {options.map((opt) => (
              <label key={opt.value} className="dropdown-option">
                <input
                  type="radio"
                  name={`${filterName}-filter`}
                  checked={currentValue === opt.value}
                  onChange={() => {
                    onChange(opt.value);
                    closeDropdown();
                  }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </th>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-content missing-samples-list-modal"
        onClick={(e) => e.stopPropagation()}
        style={modalWidth ? { width: modalWidth, maxWidth: "95vw" } : undefined}
      >
        {/* Left resize handle */}
        <div
          className="modal-resize-handle modal-resize-left"
          onMouseDown={(e) => handleResizeMouseDown("left", e)}
        />
        {/* Right resize handle */}
        <div
          className="modal-resize-handle modal-resize-right"
          onMouseDown={(e) => handleResizeMouseDown("right", e)}
        />
        <div className="modal-header">
          <h3>
            <i className="fas fa-list"></i>
            Missing Samples
          </h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          <div className="samples-tab">
            <section className="samples-section">
              <div className="filter-results-info">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    Showing {sortedRows.length} of {rows.length} slots
                  </span>
                  {typeFilter !== "all" && (
                    <span className="filter-badge">Type: {typeFilter}</span>
                  )}
                  {sourceFilter !== "all" && (
                    <span className="filter-badge">Source: {sourceFilter}</span>
                  )}
                  {hasActiveFilters && (
                    <button
                      className="reset-filters-btn"
                      onClick={resetAllFilters}
                      title="Reset all filters"
                    >
                      ✕ Reset
                    </button>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                  }}
                >
                  <div className="header-search-container">
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      className="header-search-input"
                    />
                    {searchText && (
                      <button
                        className="header-search-clear"
                        onClick={() => setSearchText("")}
                        title="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    className={`copy-table-btn ${copyFeedback === "copied" ? "copied" : ""}`}
                    onClick={copyTableToClipboard}
                    title="Copy table to clipboard (for Excel/Google Sheets)"
                  >
                    {copyFeedback === "copied" ? "✓" : "⧉"}
                  </button>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="samples-table">
                  <thead>
                    <tr>
                      <th
                        onClick={() => handleSort("slot")}
                        className="sortable col-slot"
                      >
                        Slot{" "}
                        {sortColumn === "slot" &&
                          (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      <th
                        onClick={() => handleSort("file")}
                        className="sortable col-sample"
                      >
                        File{" "}
                        {sortColumn === "file" &&
                          (sortDirection === "asc" ? "▲" : "▼")}
                      </th>
                      {renderFilterableHeader(
                        "source",
                        "Source",
                        "source",
                        sourceFilter !== "all",
                        "col-source",
                        [
                          { value: "all", label: "All" },
                          ...getUniqueSources().map((s) => ({
                            value: s,
                            label: s,
                          })),
                        ],
                        sourceFilter,
                        setSourceFilter
                      )}
                      {renderFilterableHeader(
                        "type",
                        "Type",
                        "type",
                        typeFilter !== "all",
                        "col-type",
                        [
                          { value: "all", label: "All" },
                          { value: "Flex", label: "Flex" },
                          { value: "Static", label: "Static" },
                        ],
                        typeFilter,
                        setTypeFilter
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => (
                      <tr key={`${row.slot_type}-${row.slot_id}`}>
                        <td className="col-slot">
                          {row.slot_type === "Flex" ? "F" : "S"}
                          {row.slot_id}
                        </td>
                        <td className="col-sample" title={row.original_path}>
                          {row.filename}
                        </td>
                        <td className="col-source">{row.source}</td>
                        <td className="col-type">{row.slot_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
