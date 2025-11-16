import { createContext, useContext, useState, ReactNode } from 'react';

type SortColumn = 'slot' | 'sample' | 'status' | 'source' | 'gain' | 'timestretch' | 'loop' | 'compatibility' | 'format' | 'bitdepth' | 'samplerate';
type SortDirection = 'asc' | 'desc';

interface ColumnVisibility {
  slot: boolean;
  sample: boolean;
  compatibility: boolean;
  status: boolean;
  source: boolean;
  gain: boolean;
  timestretch: boolean;
  loop: boolean;
  format: boolean;
  bitdepth: boolean;
  samplerate: boolean;
}

export interface TablePreferences {
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  searchText: string;
  compatibilityFilter: string;
  statusFilter: string;
  hideEmpty: boolean;
  sourceFilter: string;
  gainFilter: string;
  timestretchFilter: string;
  loopFilter: string;
  formatFilter: string;
  bitDepthFilter: string;
  sampleRateFilter: string;
  visibleColumns: ColumnVisibility;
}

const defaultPreferences: TablePreferences = {
  sortColumn: 'slot',
  sortDirection: 'asc',
  searchText: '',
  compatibilityFilter: 'all',
  statusFilter: 'all',
  hideEmpty: false,
  sourceFilter: 'all',
  gainFilter: 'all',
  timestretchFilter: 'all',
  loopFilter: 'all',
  formatFilter: 'all',
  bitDepthFilter: 'all',
  sampleRateFilter: 'all',
  visibleColumns: {
    slot: true,
    sample: true,
    compatibility: true,
    status: true,
    source: true,
    gain: true,
    timestretch: true,
    loop: true,
    format: false,
    bitdepth: false,
    samplerate: false,
  },
};

interface TablePreferencesContextType {
  flexPreferences: TablePreferences;
  staticPreferences: TablePreferences;
  setFlexPreferences: (prefs: TablePreferences) => void;
  setStaticPreferences: (prefs: TablePreferences) => void;
}

const TablePreferencesContext = createContext<TablePreferencesContextType | undefined>(undefined);

export function TablePreferencesProvider({ children }: { children: ReactNode }) {
  const [flexPreferences, setFlexPreferences] = useState<TablePreferences>(defaultPreferences);
  const [staticPreferences, setStaticPreferences] = useState<TablePreferences>(defaultPreferences);

  return (
    <TablePreferencesContext.Provider
      value={{
        flexPreferences,
        staticPreferences,
        setFlexPreferences,
        setStaticPreferences,
      }}
    >
      {children}
    </TablePreferencesContext.Provider>
  );
}

export function useTablePreferences() {
  const context = useContext(TablePreferencesContext);
  if (context === undefined) {
    throw new Error('useTablePreferences must be used within a TablePreferencesProvider');
  }
  return context;
}
