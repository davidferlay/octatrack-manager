import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applyItemClick, type SelectionState } from "../utils/multiSelect";
import { invalidatePoolUsage } from "../hooks/usePoolUsage";
import { formatBankName } from "./BankSelector";

/** What the tool resets. Each scope maps to one backend command. */
export type ClearScope = "banks" | "parts" | "patterns" | "tracks" | "sample_slots";

/** Mirrors Copy Tracks' own modes, so "clear" undoes exactly what "copy" did. */
export type ClearTrackMode = "part_params" | "pattern_triggers" | "both";

/** Which pool of 128 slots to clear. "both" clears the Flex and Static ones. */
export type SlotType = "flex" | "static" | "both";

const SLOT_TYPES: { id: SlotType; label: string }[] = [
  { id: "flex", label: "Flex" },
  { id: "both", label: "Both" },
  { id: "static", label: "Static" },
];

/** Backend slot_type values a SlotType maps to. */
export const slotTypesFor = (t: SlotType): ("FLEX" | "STATIC")[] =>
  t === "both" ? ["FLEX", "STATIC"] : [t.toUpperCase() as "FLEX" | "STATIC"];

export interface ClearProjectPanelProps {
  projectPath: string;
  /** Bank names for labels; index 0 = Bank A. */
  banks: { name: string }[];
  /** Which banks exist on disk - the rest cannot be targeted. */
  loadedBankIndices: Set<number>;
  /** Reload the bank the user just cleared. */
  onBankUpdated?: (bankIndex: number) => void;
  /** Reload everything (project.work changed, or several banks did). */
  onProjectRefresh?: () => void;
}

const SCOPES: { id: ClearScope; label: string; title: string }[] = [
  { id: "banks", label: "Banks", title: "Reset whole banks: every Part and Pattern they hold" },
  { id: "parts", label: "Parts", title: "Reset Parts of one bank: sound design and Part name" },
  { id: "patterns", label: "Patterns", title: "Empty Patterns of one bank: every trig, scale and chaining" },
  { id: "tracks", label: "Tracks", title: "Clear individual tracks: sound design, sequencer data, or both" },
  { id: "sample_slots", label: "Sample Slots", title: "Empty sample slots: assignment and attributes, audio files kept" },
];

const bankLetter = (i: number) => String.fromCharCode(65 + i);
const MULTI_HINT = " - shift-click for a range, ctrl-click to add";

/** T1-T8 are audio tracks (0-7), M1-M8 are MIDI tracks (8-15). */
const trackLabel = (i: number) => (i < 8 ? `T${i + 1}` : `M${i - 7}`);

const AUDIO_TRACKS = [0, 1, 2, 3, 4, 5, 6, 7];
const MIDI_TRACKS = [8, 9, 10, 11, 12, 13, 14, 15];

/** True when `selection` is exactly `group` - what marks All Audio / All MIDI on. */
const isAllOf = (selection: number[], group: number[]) =>
  selection.length === group.length && group.every((i) => selection.includes(i));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Part picker the copy tools use: 1 on top, 4 - All - 2 across the middle,
 * 3 below, laid out like the Octatrack's own part cross. Same markup and
 * classes as Copy Parts, so it looks and behaves identically here.
 *
 * Selection is "one part, or all four" - the copy tools' rule.
 */
function PartCross({ selected, onChange }: {
  selected: number[];
  onChange: (parts: number[]) => void;
}) {
  const all = selected.length === 4;
  const isOn = (part: number) => all || (selected.length === 1 && selected[0] === part);
  const pick = (part: number) => onChange(!all && selected.length === 1 && selected[0] === part ? [] : [part]);

  const partBtn = (part: number) => (
    <button
      type="button"
      className={`tools-toggle-btn part-btn ${isOn(part) ? "selected" : ""}`}
      onClick={() => pick(part)}
      title={`Part ${part + 1}`}
    >
      {part + 1}
    </button>
  );

  return (
    <div className="tools-part-cross">
      <div className="tools-part-cross-row">{partBtn(0)}</div>
      <div className="tools-part-cross-row">
        {partBtn(3)}
        <button
          type="button"
          className={`tools-toggle-btn part-btn part-all ${all ? "selected" : ""}`}
          onClick={() => onChange(all ? [] : [0, 1, 2, 3])}
          title="Select all Parts"
        >
          All
        </button>
        {partBtn(1)}
      </div>
      <div className="tools-part-cross-row">{partBtn(2)}</div>
    </div>
  );
}

/** Human-readable summary of what Execute is about to destroy. */
export function describeClear(args: {
  scope: ClearScope;
  bankIndices: number[];
  bankIndex: number;
  partIndices: number[];
  patternIndices: number[];
  trackIndices: number[];
  trackParts: number[];
  trackMode: ClearTrackMode;
  slotType: SlotType;
  slotFrom: number;
  slotTo: number;
}): string {
  const bank = `Bank ${bankLetter(args.bankIndex)}`;
  switch (args.scope) {
    case "banks":
      return `${plural(args.bankIndices.length, "bank")} (${args.bankIndices.map(bankLetter).join(", ")})`;
    case "parts":
      return `${plural(args.partIndices.length, "part")} (${args.partIndices.map((p) => p + 1).join(", ")}) of ${bank}`;
    case "patterns":
      return `${plural(args.patternIndices.length, "pattern")} (${args.patternIndices.map((p) => p + 1).join(", ")}) of ${bank}`;
    case "tracks": {
      const what =
        args.trackMode === "part_params"
          ? "part parameters"
          : args.trackMode === "pattern_triggers"
            ? "pattern triggers"
            : "part parameters and pattern triggers";
      const where =
        args.trackMode === "part_params"
          ? ""
          : args.patternIndices.length === 16
            ? ", all 16 patterns"
            : `, ${plural(args.patternIndices.length, "pattern")} (${args.patternIndices.map((p) => p + 1).join(", ")})`;
      // A sequencer-only clear touches no Part, so naming one would be a lie.
      const parts =
        args.trackMode === "pattern_triggers"
          ? ""
          : args.trackParts.length === 4
            ? " all parts"
            : ` Part ${args.trackParts.map((p) => p + 1).join(", ") || "-"}`;
      return `${what} of ${plural(args.trackIndices.length, "track")} (${args.trackIndices.map(trackLabel).join(", ")}) in ${bank}${parts}${where}`;
    }
    case "sample_slots": {
      const label = args.slotType === "both" ? "Flex and Static sample slot" : `${args.slotType === "flex" ? "Flex" : "Static"} sample slot`;
      return `${plural(args.slotTo - args.slotFrom + 1, label)} (${args.slotFrom}-${args.slotTo})`;
    }
  }
}

/**
 * "Clear Project": reset parts of the loaded project to the factory-default
 * state. Unlike the copy tools there is no source - the blank state is the
 * source - so this renders a single Target pane.
 *
 * Every scope is destructive and irreversible from inside the app, hence the
 * confirmation step and the automatic backup of each file it is about to
 * rewrite (the same `backup_project_files` the copy tools use).
 */
export function ClearProjectPanel({
  projectPath,
  banks,
  loadedBankIndices,
  onBankUpdated,
  onProjectRefresh,
}: ClearProjectPanelProps) {
  const [scope, setScope] = useState<ClearScope>("banks");

  const firstLoadedBank = useMemo(() => {
    for (let i = 0; i < 16; i++) if (loadedBankIndices.has(i)) return i;
    return -1;
  }, [loadedBankIndices]);

  // "banks" scope: several banks at once, file-explorer selection.
  const [bankSelection, setBankSelection] = useState<SelectionState>({ selection: [], anchor: null });
  // Every other scope works inside one bank.
  const [bankIndex, setBankIndex] = useState<number>(-1);

  const [partIndices, setPartIndices] = useState<number[]>([]);
  const [patternSelection, setPatternSelection] = useState<SelectionState>({ selection: [], anchor: null });
  const [trackIndices, setTrackIndices] = useState<number[]>([]);
  // One part, or all four - whatever the Part cross allows.
  const [trackParts, setTrackParts] = useState<number[]>([0]);
  const [trackMode, setTrackMode] = useState<ClearTrackMode>("both");

  const [slotType, setSlotType] = useState<SlotType>("flex");
  // "One" pins the range to a single slot, "Range" opens both handles.
  const [slotMode, setSlotMode] = useState<"one" | "range">("range");
  const [slotFrom, setSlotFrom] = useState(1);
  const [slotTo, setSlotTo] = useState(128);

  const [confirming, setConfirming] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const targetBank = bankIndex === -1 ? firstLoadedBank : bankIndex;
  const patternIndices = patternSelection.selection;
  const bankIndices = bankSelection.selection;

  const toggle = (list: number[], idx: number) =>
    list.includes(idx) ? list.filter((i) => i !== idx) : [...list, idx].sort((a, b) => a - b);

  // Which of the two Tracks selectors the chosen mode actually uses. Sound
  // design lives in a Part, sequencer data lives in a Pattern, so each mode
  // asks for only what it touches - and "Both" asks for both.
  const needsPart = trackMode !== "pattern_triggers";
  const needsPatterns = trackMode !== "part_params";

  // What blocks Execute, as a message (null = ready).
  const blocker = useMemo((): string | null => {
    if (scope === "banks") return bankIndices.length === 0 ? "Select at least one bank to clear" : null;
    if (targetBank === -1) return "Select a bank";
    if (scope === "parts") return partIndices.length === 0 ? "Select at least one part" : null;
    if (scope === "patterns") return patternIndices.length === 0 ? "Select at least one pattern" : null;
    if (scope === "tracks") {
      if (trackIndices.length === 0) return "Select at least one track";
      if (needsPart && trackParts.length === 0) return "Select at least one part";
      if (needsPatterns && patternIndices.length === 0) return "Select at least one pattern";
      return null;
    }
    return null;
  }, [scope, bankIndices, targetBank, partIndices, patternIndices, trackIndices, trackParts, trackMode, needsPart, needsPatterns, slotFrom, slotTo]);

  const summary = describeClear({
    scope, bankIndices, bankIndex: targetBank, partIndices, patternIndices,
    trackIndices, trackParts, trackMode, slotType, slotFrom, slotTo,
  });

  const slotCount = slotTo - slotFrom + 1;

  /** Commit a typed range, keeping the ends ordered and honouring One mode. */
  function setSlotRange(from: number, to: number) {
    const start = Math.min(from, to);
    const end = slotMode === "one" ? start : Math.max(from, to);
    setSlotFrom(start);
    setSlotTo(end);
  }

  const bankFile = (idx: number) => `bank${String(idx + 1).padStart(2, "0")}.work`;

  async function execute() {
    setConfirming(false);
    setIsExecuting(true);
    setStatus(null);
    try {
      // Back up exactly what is about to be rewritten, like the copy tools do.
      const files = scope === "banks"
        ? bankIndices.map(bankFile)
        : scope === "sample_slots"
          ? ["project.work"]
          : [bankFile(targetBank)];
      await invoke("backup_project_files", { projectPath, files, label: `clear_${scope}` });

      switch (scope) {
        case "banks":
          await invoke("clear_banks", { project: projectPath, bankIndices });
          break;
        case "parts":
          await invoke("clear_parts", { project: projectPath, bankIndex: targetBank, partIndices });
          break;
        case "patterns":
          await invoke("clear_patterns", { project: projectPath, bankIndex: targetBank, patternIndices });
          break;
        case "tracks": {
          // Sound design is per Part, sequencer data is not - so "Both" is sent
          // as its two halves rather than once per Part, which would clear the
          // same trigs again for every Part selected.
          const track = { project: projectPath, bankIndex: targetBank, trackIndices };
          if (needsPart) {
            for (const partIndex of trackParts) {
              await invoke("clear_tracks", {
                ...track,
                partIndex,
                mode: "part_params",
                patternIndices: null,
              });
            }
          }
          if (needsPatterns) {
            await invoke("clear_tracks", {
              ...track,
              // Unused by this mode; the command still wants a valid index.
              partIndex: 0,
              mode: "pattern_triggers",
              // null means "every pattern" on the Rust side - one call instead
              // of sixteen when the whole grid is selected.
              patternIndices: patternIndices.length === 16 ? null : patternIndices,
            });
          }
          break;
        }
        case "sample_slots": {
          const slotIndices = Array.from({ length: slotTo - slotFrom + 1 }, (_, i) => slotFrom + i);
          // "Both" is two pools of 128, so two calls.
          for (const type of slotTypesFor(slotType)) {
            await invoke("clear_sample_slots", { path: projectPath, slotType: type, slotIndices });
          }
          invalidatePoolUsage();
          break;
        }
      }

      setStatus({ kind: "ok", message: `Cleared ${summary}` });
      if (scope === "banks" || scope === "sample_slots") {
        onProjectRefresh?.();
      } else {
        onBankUpdated?.(targetBank);
      }
    } catch (error) {
      setStatus({ kind: "error", message: String(error) });
    } finally {
      setIsExecuting(false);
    }
  }

  /** Every bank that actually exists on disk - what "All" means here. */
  const selectableBanks = useMemo(
    () => Array.from({ length: 16 }, (_, i) => i).filter((i) => loadedBankIndices.has(i)),
    [loadedBankIndices]
  );

  // Shared by the Patterns scope and the trigger modes of the Tracks scope.
  const patternField = (
          <div className="tools-field">
            <label>Pattern</label>
            <div className="tools-multi-select banks-stacked">
              {[[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]].map((row, rowIdx) => (
                <div className="tools-track-row-buttons" key={rowIdx}>
                  {row.map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`tools-multi-btn ${patternIndices.includes(idx) ? "selected" : ""}`}
                      onClick={(e) => setPatternSelection((prev) =>
                        applyItemClick(prev, idx, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }))}
                      title={`Pattern ${idx + 1}${MULTI_HINT}`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              ))}
              <div className="tools-select-actions">
                <button
                  type="button"
                  className="tools-multi-btn pattern-btn tools-select-all"
                  onClick={() => setPatternSelection({ selection: [], anchor: null })}
                  title="Deselect all patterns"
                >
                  None
                </button>
                <button
                  type="button"
                  className={`tools-multi-btn pattern-btn tools-select-all ${patternIndices.length === 16 ? "selected" : ""}`}
                  onClick={() => setPatternSelection(patternIndices.length === 16
                    ? { selection: [], anchor: null }
                    : { selection: Array.from({ length: 16 }, (_, i) => i), anchor: 0 })}
                  title="Select all patterns"
                >
                  All
                </button>
              </div>
            </div>
          </div>
  );

  const bankButtons = (
    selected: (i: number) => boolean,
    onClick: (i: number, e: React.MouseEvent) => void,
    hint: string,
    actions?: { none: () => void; all: () => void; allSelected: boolean }
  ) => (
    <div className="tools-multi-select banks-stacked">
      {[[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]].map((row, rowIdx) => (
        <div className="tools-track-row-buttons" key={rowIdx}>
          {row.map((idx) => (
            <button
              key={idx}
              type="button"
              className={`tools-multi-btn bank-btn ${selected(idx) ? "selected" : ""} ${!loadedBankIndices.has(idx) ? "disabled" : ""}`}
              disabled={!loadedBankIndices.has(idx)}
              onClick={(e) => onClick(idx, e)}
              title={loadedBankIndices.has(idx)
                ? `${banks[idx] ? formatBankName(banks[idx].name, idx) : `Bank ${bankLetter(idx)}`}${hint}`
                : "Bank not loaded"}
            >
              {bankLetter(idx)}
            </button>
          ))}
        </div>
      ))}
      {actions && (
        <div className="tools-select-actions">
          <button
            type="button"
            className="tools-multi-btn bank-btn tools-select-all"
            onClick={actions.none}
            title="Deselect all banks"
          >
            None
          </button>
          <button
            type="button"
            className={`tools-multi-btn bank-btn tools-select-all ${actions.allSelected ? "selected" : ""}`}
            onClick={actions.all}
            title="Select all banks"
          >
            All
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="tools-panels tools-clear-panels">
      <div className="tools-source-panel tools-clear-panel">
        <h3>Target</h3>

        <div className="tools-field">
          <label>Clear</label>
          <div className="tools-toggle-group tools-clear-scopes">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`tools-toggle-btn ${scope === s.id ? "selected" : ""}`}
                onClick={() => { setScope(s.id); setStatus(null); }}
                title={s.title}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {scope === "banks" && (
          <div className="tools-field">
            <label>Bank</label>
            {bankButtons(
              (i) => bankIndices.includes(i),
              (i, e) => setBankSelection((prev) =>
                applyItemClick(prev, i, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }, (idx) => loadedBankIndices.has(idx))),
              MULTI_HINT,
              {
                none: () => setBankSelection({ selection: [], anchor: null }),
                all: () => setBankSelection((prev) =>
                  prev.selection.length === selectableBanks.length
                    ? { selection: [], anchor: null }
                    : { selection: selectableBanks, anchor: selectableBanks[0] ?? null }),
                allSelected: bankIndices.length === selectableBanks.length && selectableBanks.length > 0,
              }
            )}
            <div className="tools-hint">A cleared bank loses every part and pattern it holds.</div>
          </div>
        )}

        {scope !== "banks" && scope !== "sample_slots" && (
          <div className="tools-field">
            <label>Bank</label>
            {bankButtons((i) => targetBank === i, (i) => setBankIndex(targetBank === i ? -1 : i), "")}
          </div>
        )}

        {scope === "parts" && (
          <div className="tools-field">
            <label>Part</label>
            <PartCross selected={partIndices} onChange={setPartIndices} />
          </div>
        )}

        {scope === "patterns" && patternField}

        {scope === "tracks" && (
          <>
            <div className="tools-field">
              <label>Track</label>
              {/* Same grid as the Pattern one: full-width rows plus an action
                  row, with Copy Tracks' All Audio / All MIDI split. */}
              <div className="tools-multi-select tracks-stacked">
                {[[0, 1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14, 15]].map((row, rowIdx) => (
                  <div className="tools-track-row-buttons" key={rowIdx}>
                    {row.map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`tools-multi-btn track-btn ${trackIndices.includes(idx) ? "selected" : ""}`}
                        onClick={() => setTrackIndices((prev) => toggle(prev, idx))}
                        title={idx < 8 ? `Audio Track ${idx + 1}` : `MIDI Track ${idx - 7}`}
                      >
                        {trackLabel(idx)}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="tools-select-actions">
                  <button
                    type="button"
                    className="tools-multi-btn track-btn tools-select-all"
                    onClick={() => setTrackIndices([])}
                    title="Deselect all tracks"
                  >
                    None
                  </button>
                  <button
                    type="button"
                    className={`tools-multi-btn track-btn tools-select-all ${isAllOf(trackIndices, AUDIO_TRACKS) ? "selected" : ""}`}
                    onClick={() => setTrackIndices(isAllOf(trackIndices, AUDIO_TRACKS) ? [] : AUDIO_TRACKS)}
                    title="Select all Audio tracks"
                  >
                    All Audio
                  </button>
                  <button
                    type="button"
                    className={`tools-multi-btn track-btn tools-select-all ${isAllOf(trackIndices, MIDI_TRACKS) ? "selected" : ""}`}
                    onClick={() => setTrackIndices(isAllOf(trackIndices, MIDI_TRACKS) ? [] : MIDI_TRACKS)}
                    title="Select all MIDI tracks"
                  >
                    All MIDI
                  </button>
                </div>
              </div>
            </div>

            {/* The Part cross is narrow and tall; Clear Mode sits in the space
                beside it rather than costing another full row. */}
            <div className="tools-clear-row">
              {needsPart && (
                <div className="tools-field">
                  <label>Part</label>
                  <PartCross selected={trackParts} onChange={setTrackParts} />
                </div>
              )}

              <div className="tools-field">
              <label>Clear Mode</label>
              <div className="tools-toggle-group tools-toggle-stack">
                {([
                  ["part_params", "Part Parameters", "Per-track sound design: machine, params, FX, volume, LFO, recorder"],
                  ["both", "Both", "Sound design and sequencer data"],
                  ["pattern_triggers", "Pattern Triggers", "Sequencer data only: trigs, trigless trigs, parameter locks"],
                ] as [ClearTrackMode, string, string][]).map(([id, label, title]) => (
                  <button
                    key={id}
                    type="button"
                    className={`tools-toggle-btn ${trackMode === id ? "selected" : ""}`}
                    onClick={() => setTrackMode(id)}
                    title={title}
                  >
                    {label}
                  </button>
                ))}
              </div>
              </div>
            </div>

            {/* Which patterns lose their trigs - only meaningful once the mode
                includes them, so it follows Clear Mode rather than leading it. */}
            {needsPatterns && patternField}
          </>
        )}

        {scope === "sample_slots" && (
          <>
            <div className="tools-field">
              <label>Slot Type</label>
              <div className="tools-toggle-group">
                {SLOT_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`tools-toggle-btn ${slotType === t.id ? "selected" : ""}`}
                    onClick={() => setSlotType(t.id)}
                    title={t.id === "both" ? "Clear the same range in both the Flex and Static slots" : `Clear ${t.label} slots`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tools-field">
              <label>Slots</label>
              {/* Same widget as Copy Sample Slots: a One/Range header with the
                  live count, over a single or dual-handle slider. */}
              <div className="tools-slot-selector">
                <div className="tools-slot-header">
                  <div className="tools-slot-range-display">
                    <input
                      type="text"
                      inputMode="numeric"
                      className="tools-slot-value-input"
                      aria-label="First slot to clear"
                      title={slotMode === "one" ? "Slot to clear" : "First slot to clear"}
                      key={`from-${slotFrom}`}
                      defaultValue={slotFrom}
                      onBlur={(e) => setSlotRange(clampSlot(e.target.value, slotFrom), slotTo)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                    {slotMode === "range" && (
                      <>
                        <span className="tools-slot-separator">–</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="tools-slot-value-input"
                          aria-label="Last slot to clear"
                          title="Last slot to clear"
                          key={`to-${slotTo}`}
                          defaultValue={slotTo}
                          onBlur={(e) => setSlotRange(slotFrom, clampSlot(e.target.value, slotTo))}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        />
                      </>
                    )}
                  </div>
                  <div className="tools-slot-count" title="Number of slots selected">
                    <span className="tools-slot-count-number">{slotCount}</span>
                    <span className="tools-slot-count-label">slot{slotCount !== 1 ? "s" : ""}</span>
                  </div>
                  <button
                    type="button"
                    className={`tools-slot-all-btn ${slotMode === "one" ? "selected" : ""}`}
                    onClick={() => { setSlotMode("one"); setSlotTo(slotFrom); }}
                    title="Select a single slot"
                  >
                    One
                  </button>
                  <button
                    type="button"
                    className={`tools-slot-all-btn ${slotMode === "range" ? "selected" : ""}`}
                    onClick={() => setSlotMode("range")}
                    title="Select a range of slots"
                  >
                    Range
                  </button>
                </div>
                {slotMode === "one" ? (
                  <div className="tools-dual-range-slider tools-single-range">
                    <input
                      type="range"
                      className="tools-dual-range-input"
                      aria-label="Slot to clear"
                      title="Slot to clear"
                      min="1"
                      max="128"
                      value={slotFrom}
                      onChange={(e) => setSlotRange(Number(e.target.value), Number(e.target.value))}
                    />
                  </div>
                ) : (
                  <div className="tools-dual-range-slider">
                    <div
                      className="tools-dual-range-track-fill"
                      style={{
                        left: `${((slotFrom - 1) / 127) * 100}%`,
                        width: `${((slotTo - slotFrom) / 127) * 100}%`,
                      }}
                    />
                    <input
                      type="range"
                      className="tools-dual-range-input tools-dual-range-min"
                      aria-label="First slot to clear (slider)"
                      title="First slot to clear"
                      min="1"
                      max="128"
                      value={slotFrom}
                      onChange={(e) => {
                        const start = Number(e.target.value);
                        if (start <= slotTo) setSlotFrom(start);
                      }}
                    />
                    <input
                      type="range"
                      className="tools-dual-range-input tools-dual-range-max"
                      aria-label="Last slot to clear (slider)"
                      title="Last slot to clear"
                      min="1"
                      max="128"
                      value={slotTo}
                      onChange={(e) => {
                        const end = Number(e.target.value);
                        if (end >= slotFrom) setSlotTo(end);
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="tools-hint">
                Clears the slot: its sample assignment and its attributes. The audio file itself is left on disk.
              </div>
            </div>
          </>
        )}

      </div>

      <div className="tools-actions tools-clear-actions">
        {/* Say out loud what Execute is about to destroy, before it is pressed.
            While something is still missing there is nothing meaningful to
            state, so the line is left out - the disabled button's tooltip
            carries the reason. */}
        {!blocker && (
          <div className="tools-clear-summary">
            <span className="tools-clear-summary-ready">Clears {summary}</span>
          </div>
        )}
        <button
          className="tools-execute-btn tools-clear-btn"
          onClick={() => setConfirming(true)}
          disabled={isExecuting || blocker !== null}
          title={blocker ?? `Clear ${summary}`}
        >
          <i className="fas fa-eraser"></i>
          Execute
        </button>
        {status && (
          <div className={`tools-hint ${status.kind === "error" ? "tools-hint-error" : ""}`}>
            {status.message}
          </div>
        )}
      </div>

      {confirming && (
        <div className="modal-overlay" onClick={() => setConfirming(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <i className="fas fa-triangle-exclamation" style={{ color: "var(--elektron-orange)", marginRight: "0.5rem" }}></i>
                Clear Project
              </h3>
            </div>
            <div className="modal-body">
              <p>This resets {summary} to the factory-default state.</p>
              <div className="tools-clear-note">
                <i className="fas fa-shield-halved"></i>
                <span>Rewritten files are backed up in project's directory.</span>
              </div>
            </div>
            <div className="modal-footer">
              <div className="modal-buttons-row">
                <button className="modal-button" onClick={() => setConfirming(false)}>Cancel</button>
                <button className="modal-button primary" onClick={execute}>Clear</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Slot inputs accept 1-128; anything else keeps the previous value. */
function clampSlot(raw: string, fallback: number): number {
  const value = parseInt(raw, 10);
  if (isNaN(value)) return fallback;
  return Math.min(128, Math.max(1, value));
}
