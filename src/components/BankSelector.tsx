import type { Bank } from "../context/ProjectsContext";

interface BankSelectorProps {
  id: string;
  banks: Bank[];
  value: number;
  onChange: (bankIndex: number) => void;
  currentBank?: number;
}

// Special value for "all banks" option
export const ALL_BANKS = -1;

export function BankSelector({ id, banks, value, onChange, currentBank }: BankSelectorProps) {
  return (
    <div className="selector-group">
      <label htmlFor={id} className="bank-selector-label">
        Bank:
      </label>
      <select
        id={id}
        className="bank-selector"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={ALL_BANKS}>All Banks</option>
        {banks.map((bank, index) => (
          <option key={bank.id} value={index}>
            {bank.name} ({index + 1}){index === currentBank ? ' (Active)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
