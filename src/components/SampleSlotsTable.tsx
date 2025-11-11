import { useState } from "react";

interface SampleSlot {
  slot_id: number;
  slot_type: string;
  path: string | null;
  gain: number | null;
  loop_mode: string | null;
  timestretch_mode: string | null;
  source_location: string | null;
  file_exists: boolean;
}

interface SampleSlotsTableProps {
  slots: SampleSlot[];
  slotPrefix: string; // "F" for Flex, "S" for Static
}

type SortColumn = 'slot' | 'sample' | 'status' | 'source' | 'gain' | 'timestretch' | 'loop';
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
        default:
          return 0;
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const sortedSlots = sortSlots(slots);

  return (
    <div className="samples-tab">
      <section className="samples-section">
        <table className="samples-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('slot')} className="sortable">
                Slot {sortColumn === 'slot' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('sample')} className="sortable">
                Sample {sortColumn === 'sample' && (sortDirection === 'asc' ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('status')} className="sortable">
                Status {sortColumn === 'status' && (sortDirection === 'asc' ? '▲' : '▼')}
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
      </section>
    </div>
  );
}
