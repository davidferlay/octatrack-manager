import type { Bank } from "../context/ProjectsContext";

interface BankSelectorProps {
  id: string;
  banks: Bank[];
  value: number;
  onChange: (bankIndex: number) => void;
  currentBank?: number;
  loadedBankIndices?: Set<number>;  // Set of loaded bank indices
  failedBankIndices?: Map<number, string>;  // Map of failed bank indices to error messages
  allBanksLoaded?: boolean;  // Whether all banks are fully loaded
}

// Special value for "all banks" option
export const ALL_BANKS = -1;

// Bank letters for display
const BANK_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];

// Helper function to format bank name with number
export function formatBankName(bankName: string, bankIndex: number): string {
  return `${bankName} (${bankIndex + 1})`;
}

export function BankSelector({ id, banks, value, onChange, currentBank, loadedBankIndices, failedBankIndices, allBanksLoaded = false }: BankSelectorProps) {
  const hasAnyBanks = loadedBankIndices ? loadedBankIndices.size > 0 : banks.length > 0;
  const isFullyDisabled = !hasAnyBanks;

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
        disabled={isFullyDisabled}
        title={isFullyDisabled ? "Loading banks..." : undefined}
      >
        {isFullyDisabled ? (
          <option value={value}>Loading banks...</option>
        ) : (
          <>
            <option value={ALL_BANKS} disabled={!allBanksLoaded}>
              {allBanksLoaded ? 'All Banks' : 'All Banks (loading...)'}
            </option>
            {BANK_LETTERS.map((letter, index) => {
              const bank = banks[index];
              const isLoaded = loadedBankIndices ? loadedBankIndices.has(index) : !!bank;
              const isFailed = failedBankIndices?.has(index);
              const isActive = index === currentBank;

              let label: string;
              if (isLoaded && bank) {
                label = `${formatBankName(bank.name, index)}${isActive ? ' (Active)' : ''}`;
              } else if (isFailed) {
                label = `Bank ${letter} (unsupported)`;
              } else {
                label = `Bank ${letter} (loading...)`;
              }

              return (
                <option key={letter} value={index} disabled={!isLoaded || isFailed}>
                  {label}
                </option>
              );
            })}
          </>
        )}
      </select>
    </div>
  );
}
