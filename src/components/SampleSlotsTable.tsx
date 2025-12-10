import { useState, useRef, useEffect, useTransition } from "react";
import { useTablePreferences } from "../context/TablePreferencesContext";

interface SampleSlot {
  slot_id: number;
  slot_type: string;
  path: string | null;
  gain: number | null;
  loop_mode: string | null;
  timestretch_mode: string | null;
  source_location: string | null;
  file_exists: boolean;
  compatibility: string | null; // "compatible", "wrong_rate", "incompatible", "unknown"
  file_format: string | null; // "WAV", "AIFF", etc.
  bit_depth: number | null; // 16, 24, etc.
  sample_rate: number | null; // 44100, 48000, etc.
}

interface SampleSlotsTableProps {
  slots: SampleSlot[];
  slotPrefix: string; // "F" for Flex, "S" for Static
  tableType: 'flex' | 'static'; // Identify which table this is
  projectPath?: string | null; // Project path for tooltip display
}

type SortColumn = 'slot' | 'sample' | 'status' | 'source' | 'gain' | 'timestretch' | 'loop' | 'compatibility' | 'format' | 'bitdepth' | 'samplerate';
type SortDirection = 'asc' | 'desc';

// Helper function to extract filename from path
function getFilename(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/); // Split by both forward and backward slashes
  return parts[parts.length - 1] || '';
}

// Helper function to extract directory path (without filename)
function getDirectoryPath(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/); // Split by both forward and backward slashes
  parts.pop(); // Remove filename
  return parts.join('/') + '/';
}

// Helper function to extract Set-relative path (SetName/ProjectName/)
function getSetRelativePath(projectPath: string | null): string {
  if (!projectPath) return '';
  const parts = projectPath.split(/[\\/]/).filter(p => p); // Split and remove empty parts
  // Get last two parts: SetName/ProjectName
  if (parts.length >= 2) {
    return parts.slice(-2).join('/') + '/';
  } else if (parts.length === 1) {
    return parts[0] + '/';
  }
  return projectPath;
}

export function SampleSlotsTable({ slots, slotPrefix, tableType, projectPath }: SampleSlotsTableProps) {
  const { flexPreferences, staticPreferences, setFlexPreferences, setStaticPreferences } = useTablePreferences();

  // Get the preferences for this table type
  const prefs = tableType === 'flex' ? flexPreferences : staticPreferences;
  const setPrefs = tableType === 'flex' ? setFlexPreferences : setStaticPreferences;

  const [sortColumn, setSortColumn] = useState<SortColumn>(prefs.sortColumn);
  const [sortDirection, setSortDirection] = useState<SortDirection>(prefs.sortDirection);

  // Filter state
  const [searchText, setSearchText] = useState(prefs.searchText);
  const [compatibilityFilter, setCompatibilityFilter] = useState<string>(prefs.compatibilityFilter);
  const [statusFilter, setStatusFilter] = useState<string>(prefs.statusFilter);
  const [hideEmpty, setHideEmpty] = useState(prefs.hideEmpty);
  const [hideEmptyVisual, setHideEmptyVisual] = useState(prefs.hideEmpty); // Immediate visual state for toggle
  const [isPending, startTransition] = useTransition();
  const [sourceFilter, setSourceFilter] = useState<string>(prefs.sourceFilter);
  const [gainFilter, setGainFilter] = useState<string>(prefs.gainFilter);
  const [timestretchFilter, setTimestretchFilter] = useState<string>(prefs.timestretchFilter);
  const [loopFilter, setLoopFilter] = useState<string>(prefs.loopFilter);
  const [formatFilter, setFormatFilter] = useState<string>(prefs.formatFilter);
  const [bitDepthFilter, setBitDepthFilter] = useState<string>(prefs.bitDepthFilter);
  const [sampleRateFilter, setSampleRateFilter] = useState<string>(prefs.sampleRateFilter);

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState(prefs.visibleColumns);
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  // Save preferences whenever they change
  useEffect(() => {
    setPrefs({
      sortColumn,
      sortDirection,
      searchText,
      compatibilityFilter,
      statusFilter,
      hideEmpty,
      sourceFilter,
      gainFilter,
      timestretchFilter,
      loopFilter,
      formatFilter,
      bitDepthFilter,
      sampleRateFilter,
      visibleColumns,
    });
  }, [
    sortColumn,
    sortDirection,
    searchText,
    compatibilityFilter,
    statusFilter,
    hideEmpty,
    sourceFilter,
    gainFilter,
    timestretchFilter,
    loopFilter,
    formatFilter,
    bitDepthFilter,
    sampleRateFilter,
    visibleColumns,
    setPrefs,
  ]);

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Toggle column visibility
  const toggleColumn = (column: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  // Helper functions to get unique values
  const getUniqueSources = () => {
    const sources = new Set<string>();
    slots.forEach(slot => {
      if (slot.source_location) {
        sources.add(slot.source_location);
      }
    });
    return Array.from(sources).sort();
  };

  const getUniqueGains = () => {
    const gains = new Set<number>();
    slots.forEach(slot => {
      if (slot.gain !== null && slot.gain !== undefined) {
        gains.add(slot.gain);
      }
    });
    return Array.from(gains).sort((a, b) => a - b);
  };

  const getUniqueTimestretches = () => {
    const modes = new Set<string>();
    slots.forEach(slot => {
      if (slot.timestretch_mode) {
        modes.add(slot.timestretch_mode);
      }
    });
    return Array.from(modes).sort();
  };

  const getUniqueLoopModes = () => {
    const modes = new Set<string>();
    slots.forEach(slot => {
      if (slot.loop_mode) {
        modes.add(slot.loop_mode);
      }
    });
    return Array.from(modes).sort();
  };

  const getUniqueFormats = () => {
    const formats = new Set<string>();
    slots.forEach(slot => {
      if (slot.file_format) {
        formats.add(slot.file_format);
      }
    });
    return Array.from(formats).sort();
  };

  const getUniqueBitDepths = () => {
    const bitDepths = new Set<number>();
    slots.forEach(slot => {
      if (slot.bit_depth !== null && slot.bit_depth !== undefined) {
        bitDepths.add(slot.bit_depth);
      }
    });
    return Array.from(bitDepths).sort((a, b) => a - b);
  };

  const getUniqueSampleRates = () => {
    const sampleRates = new Set<number>();
    slots.forEach(slot => {
      if (slot.sample_rate !== null && slot.sample_rate !== undefined) {
        sampleRates.add(slot.sample_rate);
      }
    });
    return Array.from(sampleRates).sort((a, b) => a - b);
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const filterSlots = (slotsToFilter: SampleSlot[]) => {
    return slotsToFilter.filter((slot) => {
      // Filter by empty slots
      if (hideEmpty && !slot.path) {
        return false;
      }

      // Filter by search text
      if (searchText) {
        const filename = getFilename(slot.path);
        if (!filename.toLowerCase().includes(searchText.toLowerCase())) {
          return false;
        }
      }

      // Filter by compatibility
      if (compatibilityFilter !== 'all') {
        if (slot.compatibility !== compatibilityFilter) {
          return false;
        }
      }

      // Filter by status
      if (statusFilter === 'exists' && !slot.file_exists) {
        return false;
      }
      if (statusFilter === 'missing' && slot.file_exists) {
        return false;
      }

      // Filter by source
      if (sourceFilter !== 'all') {
        if (slot.source_location !== sourceFilter) {
          return false;
        }
      }

      // Filter by gain
      if (gainFilter !== 'all') {
        const gainValue = slot.gain?.toString();
        if (gainValue !== gainFilter) {
          return false;
        }
      }

      // Filter by timestretch
      if (timestretchFilter !== 'all') {
        if (slot.timestretch_mode !== timestretchFilter) {
          return false;
        }
      }

      // Filter by loop mode
      if (loopFilter !== 'all') {
        if (slot.loop_mode !== loopFilter) {
          return false;
        }
      }

      // Filter by format
      if (formatFilter !== 'all') {
        if (slot.file_format !== formatFilter) {
          return false;
        }
      }

      // Filter by bit depth
      if (bitDepthFilter !== 'all') {
        const bitDepthValue = slot.bit_depth?.toString();
        if (bitDepthValue !== bitDepthFilter) {
          return false;
        }
      }

      // Filter by sample rate
      if (sampleRateFilter !== 'all') {
        const sampleRateValue = slot.sample_rate?.toString();
        if (sampleRateValue !== sampleRateFilter) {
          return false;
        }
      }

      return true;
    });
  };

  const sortSlots = (slotsToSort: SampleSlot[]) => {
    return [...slotsToSort].sort((a, b) => {
      let compareA: any;
      let compareB: any;

      switch (sortColumn) {
        case 'slot':
          compareA = a.slot_id;
          compareB = b.slot_id;
          break;
        case 'sample':
          compareA = getFilename(a.path);
          compareB = getFilename(b.path);
          break;
        case 'status':
          compareA = a.file_exists ? 1 : 0;
          compareB = b.file_exists ? 1 : 0;
          break;
        case 'source':
          compareA = a.source_location || '';
          compareB = b.source_location || '';
          break;
        case 'gain':
          compareA = a.gain ?? -1;
          compareB = b.gain ?? -1;
          break;
        case 'timestretch':
          compareA = a.timestretch_mode || '';
          compareB = b.timestretch_mode || '';
          break;
        case 'loop':
          compareA = a.loop_mode || '';
          compareB = b.loop_mode || '';
          break;
        case 'compatibility':
          // Sort order: compatible > wrong_rate > unknown > incompatible > null
          const compatOrder: Record<string, number> = {
            'compatible': 4,
            'wrong_rate': 3,
            'unknown': 2,
            'incompatible': 1
          };
          compareA = a.compatibility ? (compatOrder[a.compatibility] ?? 0) : 0;
          compareB = b.compatibility ? (compatOrder[b.compatibility] ?? 0) : 0;
          break;
        case 'format':
          compareA = a.file_format || '';
          compareB = b.file_format || '';
          break;
        case 'bitdepth':
          compareA = a.bit_depth ?? -1;
          compareB = b.bit_depth ?? -1;
          break;
        case 'samplerate':
          compareA = a.sample_rate ?? -1;
          compareB = b.sample_rate ?? -1;
          break;
        default:
          return 0;
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const filteredSlots = filterSlots(slots);
  const sortedSlots = sortSlots(filteredSlots);

  return (
    <div className="samples-tab">
      <section className="samples-section">
        <div className="filter-results-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>Showing {sortedSlots.length} of {slots.length} slots</span>
            {compatibilityFilter !== 'all' && <span className="filter-badge">Compat: {compatibilityFilter}</span>}
            {statusFilter !== 'all' && <span className="filter-badge">Status: {statusFilter}</span>}
            {sourceFilter !== 'all' && <span className="filter-badge">Source: {sourceFilter}</span>}
            {gainFilter !== 'all' && <span className="filter-badge">Gain: {gainFilter}</span>}
            {timestretchFilter !== 'all' && <span className="filter-badge">Timestretch: {timestretchFilter}</span>}
            {loopFilter !== 'all' && <span className="filter-badge">Loop: {loopFilter}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                  onClick={() => setSearchText('')}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            <label className={`toggle-switch ${isPending ? 'pending' : ''}`}>
              <span className="toggle-label">Hide empty</span>
              <div className="toggle-slider-container">
                <input
                  type="checkbox"
                  checked={hideEmptyVisual}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    // Update visual state immediately for smooth toggle animation
                    setHideEmptyVisual(newValue);
                    // Update actual filter state in a transition for smooth UI
                    startTransition(() => {
                      setHideEmpty(newValue);
                    });
                  }}
                />
                <span className="toggle-slider"></span>
              </div>
            </label>
            <div className="column-visibility-control" ref={columnMenuRef}>
            <button
              className="column-visibility-btn"
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              title="Show/Hide Columns"
            >
              ☰
            </button>
            {showColumnMenu && (
              <div className="column-visibility-menu">
                <div className="column-visibility-header">Show/Hide Columns</div>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.slot}
                    onChange={() => toggleColumn('slot')}
                  />
                  <span>Slot</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.sample}
                    onChange={() => toggleColumn('sample')}
                  />
                  <span>Sample</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.compatibility}
                    onChange={() => toggleColumn('compatibility')}
                  />
                  <span>Compatibility</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.status}
                    onChange={() => toggleColumn('status')}
                  />
                  <span>Status</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.source}
                    onChange={() => toggleColumn('source')}
                  />
                  <span>Source</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.gain}
                    onChange={() => toggleColumn('gain')}
                  />
                  <span>Gain</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.timestretch}
                    onChange={() => toggleColumn('timestretch')}
                  />
                  <span>Timestretch</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.loop}
                    onChange={() => toggleColumn('loop')}
                  />
                  <span>Loop</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.format}
                    onChange={() => toggleColumn('format')}
                  />
                  <span>Format</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.bitdepth}
                    onChange={() => toggleColumn('bitdepth')}
                  />
                  <span>Bit Depth</span>
                </label>
                <label className="column-visibility-option">
                  <input
                    type="checkbox"
                    checked={visibleColumns.samplerate}
                    onChange={() => toggleColumn('samplerate')}
                  />
                  <span>Sample Rate</span>
                </label>
              </div>
            )}
            </div>
          </div>
        </div>
        <div className="table-wrapper" ref={dropdownRef}>
          <table className="samples-table">
            <thead>
              <tr>
                {visibleColumns.slot && (
                  <th onClick={() => handleSort('slot')} className="sortable col-slot">
                    Slot {sortColumn === 'slot' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                )}
                {visibleColumns.sample && (
                  <th onClick={() => handleSort('sample')} className="sortable col-sample">
                    Sample {sortColumn === 'sample' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                )}
                {visibleColumns.compatibility && (
                <th className="filterable-header col-compatibility">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('compatibility')}>
                      {sortColumn === 'compatibility' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('compatibility')} className="sortable-label">
                      Compat
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'compatibility' || compatibilityFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'compatibility' ? null : 'compatibility');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'compatibility' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="compatibility"
                            checked={compatibilityFilter === 'all'}
                            onChange={() => setCompatibilityFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="compatibility"
                            checked={compatibilityFilter === 'compatible'}
                            onChange={() => setCompatibilityFilter('compatible')}
                          />
                          <span>Compatible :)</span>
                        </label>
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="compatibility"
                            checked={compatibilityFilter === 'wrong_rate'}
                            onChange={() => setCompatibilityFilter('wrong_rate')}
                          />
                          <span>Wrong Rate :|</span>
                        </label>
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="compatibility"
                            checked={compatibilityFilter === 'incompatible'}
                            onChange={() => setCompatibilityFilter('incompatible')}
                          />
                          <span>Incompatible :(</span>
                        </label>
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="compatibility"
                            checked={compatibilityFilter === 'unknown'}
                            onChange={() => setCompatibilityFilter('unknown')}
                          />
                          <span>Unknown ??</span>
                        </label>
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.status && (
                <th className="filterable-header col-status">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('status')}>
                      {sortColumn === 'status' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('status')} className="sortable-label">
                      Status
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'status' || statusFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'status' ? null : 'status');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'status' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="status"
                            checked={statusFilter === 'all'}
                            onChange={() => setStatusFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="status"
                            checked={statusFilter === 'exists'}
                            onChange={() => setStatusFilter('exists')}
                          />
                          <span>File Exists</span>
                        </label>
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="status"
                            checked={statusFilter === 'missing'}
                            onChange={() => setStatusFilter('missing')}
                          />
                          <span>File Missing</span>
                        </label>
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.source && (
                <th className="filterable-header col-source">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('source')}>
                      {sortColumn === 'source' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('source')} className="sortable-label">
                      Source
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'source' || sourceFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'source' ? null : 'source');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'source' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="source"
                            checked={sourceFilter === 'all'}
                            onChange={() => setSourceFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueSources().map((source) => (
                          <label key={source} className="dropdown-option">
                            <input
                              type="radio"
                              name="source"
                              checked={sourceFilter === source}
                              onChange={() => setSourceFilter(source)}
                            />
                            <span>{source}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.gain && (
                <th className="filterable-header col-gain">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('gain')}>
                      {sortColumn === 'gain' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('gain')} className="sortable-label">
                      Gain
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'gain' || gainFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'gain' ? null : 'gain');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'gain' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="gain"
                            checked={gainFilter === 'all'}
                            onChange={() => setGainFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueGains().map((gain) => (
                          <label key={gain} className="dropdown-option">
                            <input
                              type="radio"
                              name="gain"
                              checked={gainFilter === gain.toString()}
                              onChange={() => setGainFilter(gain.toString())}
                            />
                            <span>{gain}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.timestretch && (
                <th className="filterable-header col-timestretch">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('timestretch')}>
                      {sortColumn === 'timestretch' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('timestretch')} className="sortable-label">
                      Timestretch
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'timestretch' || timestretchFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'timestretch' ? null : 'timestretch');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'timestretch' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="timestretch"
                            checked={timestretchFilter === 'all'}
                            onChange={() => setTimestretchFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueTimestretches().map((mode) => (
                          <label key={mode} className="dropdown-option">
                            <input
                              type="radio"
                              name="timestretch"
                              checked={timestretchFilter === mode}
                              onChange={() => setTimestretchFilter(mode)}
                            />
                            <span>{mode}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.loop && (
                <th className="filterable-header col-loop">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('loop')}>
                      {sortColumn === 'loop' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('loop')} className="sortable-label">
                      Loop
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'loop' || loopFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'loop' ? null : 'loop');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'loop' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="loop"
                            checked={loopFilter === 'all'}
                            onChange={() => setLoopFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueLoopModes().map((mode) => (
                          <label key={mode} className="dropdown-option">
                            <input
                              type="radio"
                              name="loop"
                              checked={loopFilter === mode}
                              onChange={() => setLoopFilter(mode)}
                            />
                            <span>{mode}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.format && (
                <th className="filterable-header col-format">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('format')}>
                      {sortColumn === 'format' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('format')} className="sortable-label">
                      Format
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'format' || formatFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'format' ? null : 'format');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'format' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="format"
                            checked={formatFilter === 'all'}
                            onChange={() => setFormatFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueFormats().map((format) => (
                          <label key={format} className="dropdown-option">
                            <input
                              type="radio"
                              name="format"
                              checked={formatFilter === format}
                              onChange={() => setFormatFilter(format)}
                            />
                            <span>{format}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.bitdepth && (
                <th className="filterable-header col-bitdepth">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('bitdepth')}>
                      {sortColumn === 'bitdepth' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('bitdepth')} className="sortable-label">
                      Bit
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'bitdepth' || bitDepthFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'bitdepth' ? null : 'bitdepth');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'bitdepth' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="bitdepth"
                            checked={bitDepthFilter === 'all'}
                            onChange={() => setBitDepthFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueBitDepths().map((bitDepth) => (
                          <label key={bitDepth} className="dropdown-option">
                            <input
                              type="radio"
                              name="bitdepth"
                              checked={bitDepthFilter === bitDepth.toString()}
                              onChange={() => setBitDepthFilter(bitDepth.toString())}
                            />
                            <span>{bitDepth}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
                {visibleColumns.samplerate && (
                <th className="filterable-header col-samplerate">
                  <div className="header-content">
                    <span className="sort-indicator" onClick={() => handleSort('samplerate')}>
                      {sortColumn === 'samplerate' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <span onClick={() => handleSort('samplerate')} className="sortable-label">
                      kHz
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'samplerate' || sampleRateFilter !== 'all' ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'samplerate' ? null : 'samplerate');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'samplerate' && (
                    <div className="filter-dropdown">
                      <div className="dropdown-options">
                        <label className="dropdown-option">
                          <input
                            type="radio"
                            name="samplerate"
                            checked={sampleRateFilter === 'all'}
                            onChange={() => setSampleRateFilter('all')}
                          />
                          <span>All</span>
                        </label>
                        {getUniqueSampleRates().map((sampleRate) => (
                          <label key={sampleRate} className="dropdown-option">
                            <input
                              type="radio"
                              name="samplerate"
                              checked={sampleRateFilter === sampleRate.toString()}
                              onChange={() => setSampleRateFilter(sampleRate.toString())}
                            />
                            <span>{(sampleRate / 1000).toFixed(1)} kHz</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </th>
                )}
              </tr>
            </thead>
          <tbody>
            {sortedSlots.map((slot) => (
              <tr key={slot.slot_id}>
                {visibleColumns.slot && <td className="col-slot">{slotPrefix}{slot.slot_id}</td>}
                {visibleColumns.sample && (
                  <td className="col-sample" title={slot.path ? getFilename(slot.path) : undefined}>
                    {slot.path ? getFilename(slot.path) : <em>Empty</em>}
                  </td>
                )}
                {visibleColumns.compatibility && (
                  <td className="compatibility-cell col-compatibility">
                    {slot.file_exists && slot.compatibility === 'compatible' && <span className="compat-badge compat-compatible" title="Compatible (WAV/AIFF, 16/24-bit, 44.1kHz)">:)</span>}
                    {slot.file_exists && slot.compatibility === 'wrong_rate' && <span className="compat-badge compat-wrong-rate" title="Wrong sample rate (plays at wrong speed)">:|</span>}
                    {slot.file_exists && slot.compatibility === 'incompatible' && <span className="compat-badge compat-incompatible" title="Incompatible bit depth)">:(</span>}
                    {slot.file_exists && slot.compatibility === 'unknown' && <span className="compat-badge compat-unknown" title="Unrecognized format (not WAV or AIFF)">??</span>}
                  </td>
                )}
                {visibleColumns.status && (
                  <td className="status-cell col-status">
                    {slot.path && (
                      <span
                        className={`file-status-badge ${slot.file_exists ? 'file-exists' : 'file-missing'}`}
                        title={slot.file_exists ? 'File exists on disk' : 'File is missing from disk'}
                      >
                        {slot.file_exists ? '✓' : '✗'}
                      </span>
                    )}
                  </td>
                )}
                {visibleColumns.source && <td className="col-source" title={slot.source_location === 'Project' ? getSetRelativePath(projectPath ?? null) : getDirectoryPath(slot.path)}>{slot.source_location || '-'}</td>}
                {visibleColumns.gain && <td className="col-gain">{slot.gain !== null && slot.gain !== undefined ? slot.gain : '-'}</td>}
                {visibleColumns.timestretch && <td className="col-timestretch">{slot.timestretch_mode || '-'}</td>}
                {visibleColumns.loop && <td className="col-loop">{slot.loop_mode || '-'}</td>}
                {visibleColumns.format && <td className="col-format">{slot.file_format || '-'}</td>}
                {visibleColumns.bitdepth && <td className="col-bitdepth">{slot.bit_depth !== null && slot.bit_depth !== undefined ? slot.bit_depth : '-'}</td>}
                {visibleColumns.samplerate && <td className="col-samplerate">{slot.sample_rate !== null && slot.sample_rate !== undefined ? (slot.sample_rate / 1000).toFixed(1) : '-'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
