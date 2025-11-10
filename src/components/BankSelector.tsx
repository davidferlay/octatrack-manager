import type { Bank } from "../context/ProjectsContext";

interface BankSelectorProps {
  id: string;
  banks: Bank[];
  value: number;
  onChange: (bankIndex: number) => void;
  currentBank?: number;
}

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
        {banks.map((bank, index) => (
          <option key={bank.id} value={index}>
            {bank.name} ({index + 1}){index === currentBank ? ' (Active)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
