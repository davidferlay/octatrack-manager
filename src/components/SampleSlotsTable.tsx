import { useState, useRef, useEffect } from "react";

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
}

interface SampleSlotsTableProps {
  slots: SampleSlot[];
  slotPrefix: string; // "F" for Flex, "S" for Static
}

type SortColumn = 'slot' | 'sample' | 'status' | 'source' | 'gain' | 'timestretch' | 'loop' | 'compatibility';
type SortDirection = 'asc' | 'desc';

// Helper function to extract filename from path
function getFilename(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/); // Split by both forward and backward slashes
  return parts[parts.length - 1] || '';
}

export function SampleSlotsTable({ slots, slotPrefix }: SampleSlotsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('slot');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Filter state
  const [searchText, setSearchText] = useState('');
  const [compatibilityFilter, setCompatibilityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [hideEmpty, setHideEmpty] = useState(false);

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          Showing {sortedSlots.length} of {slots.length} slots
          {hideEmpty && <span className="filter-badge">Empty Hidden</span>}
          {searchText && <span className="filter-badge">Filtered by: {searchText}</span>}
          {compatibilityFilter !== 'all' && <span className="filter-badge">Compat: {compatibilityFilter}</span>}
          {statusFilter !== 'all' && <span className="filter-badge">Status: {statusFilter}</span>}
        </div>
        <div className="table-wrapper" ref={dropdownRef}>
          <table className="samples-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('slot')} className="sortable">
                  Slot {sortColumn === 'slot' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th className="filterable-header">
                  <div className="header-content">
                    <span onClick={() => handleSort('sample')} className="sortable-label">
                      Sample {sortColumn === 'sample' && (sortDirection === 'asc' ? '▲' : '▼')}
                    </span>
                    <button
                      className={`filter-icon ${openDropdown === 'sample' || searchText || hideEmpty ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(openDropdown === 'sample' ? null : 'sample');
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                  {openDropdown === 'sample' && (
                    <div className="filter-dropdown">
                      <input
                        type="text"
                        placeholder="Search..."
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        className="dropdown-search"
                      />
                      <label className="dropdown-checkbox">
                        <input
                          type="checkbox"
                          checked={hideEmpty}
                          onChange={(e) => setHideEmpty(e.target.checked)}
                        />
                        <span>Hide Empty</span>
                      </label>
                      {(searchText || hideEmpty) && (
                        <button
                          className="clear-filter-btn"
                          onClick={() => {
                            setSearchText('');
                            setHideEmpty(false);
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </th>
                <th className="filterable-header">
                  <div className="header-content">
                    <span onClick={() => handleSort('compatibility')} className="sortable-label">
                      Compat {sortColumn === 'compatibility' && (sortDirection === 'asc' ? '▲' : '▼')}
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
                <th className="filterable-header">
                  <div className="header-content">
                    <span onClick={() => handleSort('status')} className="sortable-label">
                      Status {sortColumn === 'status' && (sortDirection === 'asc' ? '▲' : '▼')}
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
                <th onClick={() => handleSort('source')} className="sortable">
                  Source {sortColumn === 'source' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th onClick={() => handleSort('gain')} className="sortable">
                  Gain {sortColumn === 'gain' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th onClick={() => handleSort('timestretch')} className="sortable">
                  Timestretch {sortColumn === 'timestretch' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
                <th onClick={() => handleSort('loop')} className="sortable">
                  Loop {sortColumn === 'loop' && (sortDirection === 'asc' ? '▲' : '▼')}
                </th>
              </tr>
            </thead>
          <tbody>
            {sortedSlots.map((slot) => (
              <tr key={slot.slot_id}>
                <td>{slotPrefix}{slot.slot_id}</td>
                <td title={slot.path || undefined}>
                  {slot.path ? getFilename(slot.path) : <em>Empty</em>}
                </td>
                <td className="compatibility-cell">
                  {slot.compatibility === 'compatible' && <span className="compat-badge compat-compatible" title="Compatible (WAV/AIFF, 16/24-bit, 44.1kHz)">:)</span>}
                  {slot.compatibility === 'wrong_rate' && <span className="compat-badge compat-wrong-rate" title="Wrong sample rate (plays at wrong speed)">:|</span>}
                  {slot.compatibility === 'incompatible' && <span className="compat-badge compat-incompatible" title="Incompatible bit depth)">:(</span>}
                  {slot.compatibility === 'unknown' && <span className="compat-badge compat-unknown" title="Unrecognized format (not WAV or AIFF)">??</span>}
                </td>
                <td className="status-cell">
                  {slot.path && (
                    <span className={`file-status-badge ${slot.file_exists ? 'file-exists' : 'file-missing'}`}>
                      {slot.file_exists ? '✓' : '✗'}
                    </span>
                  )}
                </td>
                <td>{slot.source_location || '-'}</td>
                <td>{slot.gain !== null && slot.gain !== undefined ? slot.gain : '-'}</td>
                <td>{slot.timestretch_mode || '-'}</td>
                <td>{slot.loop_mode || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
