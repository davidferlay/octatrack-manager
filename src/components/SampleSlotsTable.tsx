import { useState } from "react";

interface SampleSlot {
  slot_id: number;
  slot_type: string;
  path: string | null;
  gain: number | null;
  loop_mode: string | null;
  timestretch_mode: string | null;
}

interface SampleSlotsTableProps {
  slots: SampleSlot[];
  slotPrefix: string; // "F" for Flex, "S" for Static
}

type SortColumn = 'slot' | 'sample' | 'gain' | 'timestretch' | 'loop';
type SortDirection = 'asc' | 'desc';

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
          compareA = a.path || '';
          compareB = b.path || '';
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
                <td>{slot.path || <em>Empty</em>}</td>
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
