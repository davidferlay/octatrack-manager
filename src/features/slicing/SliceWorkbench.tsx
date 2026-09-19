import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  defaultOnsetParameters, sliceApi, type OnsetParameters, type SliceApi,
  type SliceDraft, type SliceEdit, type SliceJob, type SliceMarker,
  type SliceProposal, type SliceRange, type SliceWaveform,
} from "../../api/slices";
import { useTranslate } from "../../i18n";
import { formatPreviewFrameTimeSeconds } from "../waveform/frameMath";
import type { LibraryCommittedGeometryRange } from "../waveform/WaveformPreview";
import { frame, frameAt, inRange, position, previewChannels } from "./frames";
import { SliceErrorAlert } from "./SliceErrorAlert";
import { isAnalysisSessionInvalid, normalizeSliceError, type SliceErrorState } from "./sliceErrors";
import "./SliceWorkbench.css";

export type SliceWorkbenchLayout = "compact" | "expanded";

interface Props {
  rootId: string;
  fileInstanceId: string;
  displayName: string;
  api?: SliceApi;
  librarySelectionRange?: LibraryCommittedGeometryRange | null;
  /** Sample rate from the Library preview that committed the selection (display only). */
  librarySourceSampleRate?: number | null;
  onRequestStopLibraryPlayback?: () => void;
  onAnalysisBusyChange?: (busy: boolean) => void;
  registerAnalysisCancel?: (cancel: (() => void) | null) => void;
  layout?: SliceWorkbenchLayout;
  /** When set, session UI is portaled into this element (single mount, no duplicate sessions). */
  hostElement?: HTMLElement | null;
  /** @deprecated Layout uses slice-expanded container queries; kept for test compatibility. */
  narrowExpanded?: boolean;
}
const WIDTH = 640;
const PAGE = 50;

// A new file/root unmounts the session, cancelling every pending response and sound.
export function SliceWorkbench(props: Props) {
  return <SliceSession key={`${props.rootId}:${props.fileInstanceId}`} {...props} />;
}

function SliceSession({
  rootId,
  fileInstanceId,
  displayName,
  api = sliceApi,
  librarySelectionRange = null,
  librarySourceSampleRate = null,
  onRequestStopLibraryPlayback,
  onAnalysisBusyChange,
  registerAnalysisCancel,
  layout = "compact",
  hostElement = null,
  narrowExpanded = false,
}: Props) {
  const t = useTranslate();
  const [job, setJob] = useState<SliceJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<SliceErrorState | null>(null);
  const [parameters, setParameters] = useState(defaultOnsetParameters);
  const [draft, setDraft] = useState<SliceDraft | null>(null);
  const [proposal, setProposal] = useState<SliceProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<SliceRange | null>(null);
  const [waveform, setWaveform] = useState<SliceWaveform | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [insertFrame, setInsertFrame] = useState("0");
  const [regionStart, setRegionStart] = useState("");
  const [regionEnd, setRegionEnd] = useState("");
  const [drag, setDrag] = useState<{ id: string; frame: string } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [analysisSessionInvalid, setAnalysisSessionInvalid] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const jobId = useRef<string | null>(null);
  const editBusy = useRef(false);
  const playGeneration = useRef(0);
  const context = useRef<AudioContext | null>(null);
  const sound = useRef<AudioBufferSourceNode | null>(null);
  const readyId = job?.phase === "ready" ? job.jobId : null;

  function stop() {
    playGeneration.current++;
    sound.current?.stop();
    sound.current = null;
    if (alive.current) { setPlaying(false); setPreviewing(false); }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      stop();
      void context.current?.close();
      if (jobId.current) void api.cancel(rootId, jobId.current).catch(() => undefined);
    };
  }, [api, rootId]);

  function noteCommandError(error: unknown, options: { session?: boolean } = {}) {
    const normalized = normalizeSliceError(error);
    if (options.session !== false && isAnalysisSessionInvalid(normalized)) {
      setProposal(null);
      setAnalysisSessionInvalid(true);
      setProposing(false);
    }
    setError(normalized);
  }

  async function startAnalysis(region?: SliceRange) {
    if (starting) return;
    setError(null);
    setAnalysisSessionInvalid(false);
    const epoch = ++generation.current;
    stop();
    onRequestStopLibraryPlayback?.();
    setStarting(true);
    setJob(null); setDraft(null); setProposal(null); setView(null); setWaveform(null); setSelected(null); setPage(0);
    try {
      const next = await api.start(rootId, fileInstanceId, region);
      if (!alive.current || epoch !== generation.current) {
        void api.cancel(rootId, next.jobId).catch(() => undefined);
        return;
      }
      jobId.current = next.jobId;
      setJob(next);
    } catch (e) {
      if (alive.current && epoch === generation.current) setError(normalizeSliceError(e));
    } finally {
      if (alive.current && epoch === generation.current) setStarting(false);
    }
  }

  async function analyze() {
    if (starting) return;
    setError(null);
    let region: SliceRange | undefined;
    try {
      if (regionStart || regionEnd) {
        if (frame(regionStart) >= frame(regionEnd)) throw new Error("Region end must follow its start.");
        region = { startFrame: regionStart, endExclusive: regionEnd };
      }
    } catch (e) {
      setError(normalizeSliceError(e));
      return;
    }
    await startAnalysis(region);
  }

  async function analyzeSelectedLibraryRange() {
    if (starting || librarySelectionRange === null) return;
    setError(null);
    let region: SliceRange;
    try {
      frame(librarySelectionRange.startFrame);
      frame(librarySelectionRange.endFrameExclusive);
      region = {
        startFrame: librarySelectionRange.startFrame,
        endExclusive: librarySelectionRange.endFrameExclusive,
      };
    } catch (e) {
      setError(normalizeSliceError(e));
      return;
    }
    await startAnalysis(region);
  }
  async function cancel() {
    generation.current++;
    stop();
    const id = jobId.current;
    jobId.current = null;
    setAnalysisSessionInvalid(false);
    setJob(null); setDraft(null); setProposal(null); setView(null); setStarting(false);
    if (id) {
      try { await api.cancel(rootId, id); }
      catch (e) { if (alive.current) setError(normalizeSliceError(e)); }
    }
  }
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useEffect(() => {
    if (!registerAnalysisCancel) return;
    registerAnalysisCancel(() => {
      void cancelRef.current();
    });
    return () => registerAnalysisCancel(null);
  }, [registerAnalysisCancel]);

  useEffect(() => {
    onAnalysisBusyChange?.(
      starting || job?.phase === "reading" || job?.phase === "analyzing",
    );
  }, [starting, job, onAnalysisBusyChange]);

  useEffect(() => {
    if (!job || !["reading", "analyzing"].includes(job.phase)) return;
    const epoch = generation.current;
    let active = true;
    const timer = window.setTimeout(() => {
      api.status(rootId, job.jobId).then(
        next => { if (active && epoch === generation.current) setJob(next); },
        e => {
          if (!active || epoch !== generation.current) return;
          noteCommandError(e);
          setJob({ ...job, phase: "failed" });
        },
      );
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, job, rootId]);

  useEffect(() => {
    if (!readyId || analysisSessionInvalid) return;
    const epoch = generation.current;
    let active = true;
    api.draft(rootId, readyId).then(next => {
      if (active && epoch === generation.current) {
        setDraft(next); setView(next.region); setInsertFrame(next.region.startFrame);
      }
    }, e => { if (active && epoch === generation.current) noteCommandError(e); });
    return () => { active = false; };
  }, [api, readyId, rootId, analysisSessionInvalid]);

  useEffect(() => {
    if (!readyId || !draft || analysisSessionInvalid) return;
    const epoch = generation.current;
    let active = true;
    setProposal(null); setProposing(true);
    const timer = window.setTimeout(() => {
      api.propose(rootId, readyId, draft.revision, parameters).then(
        next => {
          if (active && epoch === generation.current) {
            setProposal(next); setProposing(false);
          }
        },
        e => {
          if (active && epoch === generation.current) {
            noteCommandError(e); setProposing(false);
          }
        },
      );
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [api, draft, parameters, readyId, rootId, analysisSessionInvalid]);

  useEffect(() => {
    if (!readyId || !view || analysisSessionInvalid) return;
    const epoch = generation.current;
    let active = true;
    setWaveform(null);
    api.waveform(rootId, readyId, view, WIDTH).then(
      next => { if (active && epoch === generation.current) setWaveform(next); },
      e => { if (active && epoch === generation.current) noteCommandError(e); },
    );
    return () => { active = false; };
  }, [api, readyId, rootId, view, analysisSessionInvalid]);

  async function edit(input: SliceEdit) {
    if (!readyId || !draft || editBusy.current || analysisSessionInvalid) return;
    const epoch = generation.current;
    editBusy.current = true; setEditing(true); setError(null); stop();
    try {
      const next = await api.edit(rootId, readyId, draft.revision, input);
      if (alive.current && epoch === generation.current) {
        setDraft(next); setProposal(null);
        setPage(p => Math.min(p, Math.max(0, Math.ceil(next.markers.length / PAGE) - 1)));
      }
    } catch (e) {
      if (alive.current && epoch === generation.current) {
        const normalized = normalizeSliceError(e);
        noteCommandError(e);
        // A conflict always reloads authoritative data; never retry the mutation.
        // Session-invalid responses must not overwrite the in-memory draft.
        if (normalized.code === "DRAFT_CONFLICT") {
          try {
            const latest = await api.draft(rootId, readyId);
            if (alive.current && epoch === generation.current) setDraft(latest);
          } catch { /* Keep the conflict visible; re-analysis remains available. */ }
        }
      }
    } finally { editBusy.current = false; if (alive.current && epoch === generation.current) setEditing(false); }
  }

  async function play(range: SliceRange) {
    if (!readyId) return;
    stop(); setError(null); setPreviewing(true);
    const epoch = playGeneration.current;
    try {
      // Resume directly from the user gesture, before requesting PCM.
      context.current ??= new AudioContext();
      await context.current.resume();
      const ticket = await api.preview(rootId, readyId, range);
      const bytes = await api.readPreview(rootId, readyId, ticket.previewToken);
      if (!alive.current || epoch !== playGeneration.current) return;
      const channels = previewChannels(ticket, bytes);
      const buffer = context.current.createBuffer(ticket.channels, channels[0].length, ticket.sampleRate);
      channels.forEach((values, ch) => buffer.getChannelData(ch).set(values));
      const source = context.current.createBufferSource();
      source.buffer = buffer;
      source.connect(context.current.destination);
      source.onended = () => { if (sound.current === source) { sound.current = null; if (alive.current) setPlaying(false); } };
      sound.current = source;
      source.start(context.current.currentTime, 0, buffer.duration);
      setPlaying(true);
    } catch (e) {
      if (alive.current && epoch === playGeneration.current) {
        const normalized = normalizeSliceError(e);
        // Preview-token NOT_FOUND shares ANALYSIS_NOT_FOUND; do not kill the session.
        if (normalized.code === "ANALYSIS_EXPIRED") noteCommandError(e);
        else setError(normalized);
      }
    }
    finally { if (alive.current && epoch === playGeneration.current) setPreviewing(false); }
  }
  function changeParameter(key: keyof OnsetParameters, value: number) {
    if (analysisSessionInvalid) return;
    setProposal(null);
    setParameters(p => ({ ...p, [key]: value }));
  }
  function viewport(size: bigint, center: bigint) {
    if (!draft) return;
    const lo = frame(draft.region.startFrame), hi = frame(draft.region.endExclusive);
    size = size < 2n ? 2n : size > hi - lo ? hi - lo : size;
    let start = center - size / 2n;
    if (start < lo) start = lo;
    if (start + size > hi) start = hi - size;
    setView({ startFrame: start.toString(), endExclusive: (start + size).toString() });
  }
  function zoom(inside: boolean) {
    if (!view) return;
    const length = frame(view.endExclusive) - frame(view.startFrame);
    const marker = draft?.markers.find(m => m.markerId === selected);
    const center = marker && inRange(marker.startFrame, view) ? frame(marker.startFrame) : frame(view.startFrame) + length / 2n;
    viewport(inside ? length / 2n : length * 2n, center);
  }
  function pan(direction: bigint) {
    if (!view) return;
    const size = frame(view.endExclusive) - frame(view.startFrame);
    viewport(size, frame(view.startFrame) + size / 2n + direction * (size / 4n || 1n));
  }
  function endDrag() {
    const moved = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (moved && draft?.markers.find(m => m.markerId === moved.id)?.startFrame !== moved.frame) {
      void edit({ kind: "move", markerId: moved.id, frame: moved.frame });
    }
  }
  const busy = starting || job?.phase === "reading" || job?.phase === "analyzing";
  const mutationDisabled = editing || analysisSessionInvalid;
  const selectedMarker = draft?.markers.find(m => m.markerId === selected);
  const warnings = proposal?.candidates.filter(c => c.warnings.length > 0) ?? [];
  const analysisRegion = job?.region ?? draft?.region ?? null;
  const displayedError =
    error
    ?? (job?.error ? normalizeSliceError(job.error) : null);

  const previewSampleRate =
    librarySourceSampleRate !== null
    && librarySourceSampleRate !== undefined
    && Number.isFinite(librarySourceSampleRate)
    && librarySourceSampleRate > 0
      ? Math.trunc(librarySourceSampleRate)
      : null;

  const preamble = (
    <>
      <div className="slice-heading"><h4>{t("slicing.heading")}</h4><span>{t("slicing.localDraft")}</span></div>
      <p>{t("slicing.intro")}</p>
      <details><summary>{t("slicing.regionDetails")}</summary>
        <p>{t("slicing.supportedFormats")}</p>
        <p>{t("slicing.regionHelp")}</p>
        <div className="slice-fields">
          <label>{t("slicing.regionStart")}<input value={regionStart} onChange={e => setRegionStart(e.target.value)} inputMode="numeric" disabled={busy} /></label>
          <label>{t("slicing.regionEnd")}<input value={regionEnd} onChange={e => setRegionEnd(e.target.value)} inputMode="numeric" disabled={busy} /></label>
        </div>
      </details>
      <div
        className="slice-preview-selection"
        role="status"
        aria-label={t("slicing.previewSelectionHeading")}
      >
        <p className="slice-preview-selection__heading">{t("slicing.previewSelectionHeading")}</p>
        {librarySelectionRange === null ? (
          <p className="slice-coordinate">{t("slicing.previewSelectionNone")}</p>
        ) : (
          <>
            <p className="slice-coordinate">
              {t("slicing.analysisRegionFrames", {
                start: librarySelectionRange.startFrame,
                end: librarySelectionRange.endFrameExclusive,
              })}
            </p>
            {previewSampleRate !== null && (
              <p className="slice-coordinate">
                {t("slicing.previewSelectionSeconds", {
                  startSeconds: formatPreviewFrameTimeSeconds(
                    librarySelectionRange.startFrame,
                    previewSampleRate,
                  ),
                  endSeconds: formatPreviewFrameTimeSeconds(
                    librarySelectionRange.endFrameExclusive,
                    previewSampleRate,
                  ),
                  sampleRate: previewSampleRate,
                })}
              </p>
            )}
          </>
        )}
      </div>
      <div className="slice-actions">
        <button
          type="button"
          disabled={busy || editing || librarySelectionRange === null}
          onClick={() => void analyzeSelectedLibraryRange()}
        >
          {t("slicing.analyzeSelectedRange")}
        </button>
        <button disabled={busy || editing} onClick={() => void analyze()}>
          {busy ? t("slicing.analyzing") : readyId ? t("slicing.analyzeAgain") : t("slicing.detectAttacks")}
        </button>
        {(busy || readyId) && (
          <button disabled={editing} onClick={() => void cancel()}>
            {busy ? t("slicing.cancelAnalysis") : t("slicing.closeAnalysis")}
          </button>
        )}
      </div>
      {busy && (
        <p role="status">
          {job?.phase === "analyzing" ? t("slicing.detectingAttacks") : t("slicing.readingSource")}
        </p>
      )}
      {analysisRegion !== null && (
        <p className="slice-coordinate" role="status" aria-label={t("slicing.analysisRegionHeading")}>
          {t("slicing.analysisRegionHeading")}:{" "}
          {t("slicing.analysisRegionFrames", {
            start: analysisRegion.startFrame,
            end: analysisRegion.endExclusive,
          })}
        </p>
      )}
      <SliceErrorAlert error={displayedError} t={t} />
      {analysisSessionInvalid && (
        <p role="status" className="slice-notice">{t("slicing.reanalyzeRequired")}</p>
      )}
    </>
  );

  const detectionFieldset = readyId && draft ? (
    <fieldset disabled={mutationDisabled} className="slice-fields"><legend>{t("slicing.detectionLegend")}</legend>
      <label>{t("slicing.sensitivity")} {parameters.sensitivity}<input type="range" min="0" max="100" value={parameters.sensitivity} onChange={e => changeParameter("sensitivity", Number(e.target.value))} /></label>
      <label>{t("slicing.minimumIntervalMs")}<input type="number" min="10" max="250" value={parameters.minimumIntervalMs} onChange={e => changeParameter("minimumIntervalMs", Number(e.target.value))} /></label>
      <label>{t("slicing.preRollMs")}<input type="number" min="0" max="10" step="0.1" value={parameters.preRollUs / 1000} onChange={e => changeParameter("preRollUs", Math.round(Number(e.target.value) * 1000))} /></label>
      <label>{t("slicing.silenceFloorDb")}<input type="number" min="-90" max="-40" value={parameters.silenceFloorDb} onChange={e => changeParameter("silenceFloorDb", Number(e.target.value))} /></label>
      <label>{t("slicing.snapRadiusMs")}<input type="number" min="0" max="2" step="0.1" value={parameters.snapRadiusUs / 1000} onChange={e => changeParameter("snapRadiusUs", Math.round(Number(e.target.value) * 1000))} /></label>
    </fieldset>
  ) : null;

  const waveformBlock = readyId && draft && view ? (
    <>
      <div className="slice-actions"><button onClick={() => zoom(true)}>Zoom in</button><button onClick={() => zoom(false)}>Zoom out</button><button aria-label="Pan earlier" onClick={() => pan(-1n)}>←</button><button aria-label="Pan later" onClick={() => pan(1n)}>→</button><button onClick={() => setView(draft.region)}>Full region</button></div>
      <p className="slice-coordinate">Frames [{view.startFrame}, {view.endExclusive}) · {job?.sampleRate} Hz</p>
      <svg viewBox="0 0 640 160" preserveAspectRatio="xMidYMid meet" width="100%" height="160" className="slice-waveform" aria-label="Slice waveform"
        onDoubleClick={e => {
          if (mutationDisabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width) void edit({ kind: "insert", frame: frameAt((e.clientX - rect.left) / rect.width, view) });
        }}
        onPointerMove={e => {
          if (!dragRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (!rect.width) return;
          const next = { ...dragRef.current, frame: frameAt((e.clientX - rect.left) / rect.width, view) };
          dragRef.current = next; setDrag(next);
        }} onPointerUp={endDrag} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}>
        {waveform?.peaks.map((peaks, ch) => {
          const height = 160 / waveform.peaks.length, center = height * (ch + 0.5);
          return <path key={ch} className="slice-peaks" d={peaks.map(([min, max], i) => `M${i * WIDTH / peaks.length},${center - max * height * 0.45}V${center - min * height * 0.45}`).join(" ")} />;
        })}
        {proposal?.candidates.filter(c => inRange(c.suggestedStartFrame, view)).map(c => <line key={c.candidateId} className="slice-candidate" x1={position(c.suggestedStartFrame, view) * WIDTH} x2={position(c.suggestedStartFrame, view) * WIDTH} y1="0" y2="160"><title>{`Candidate at ${c.suggestedStartFrame}${c.warnings.length ? " — review boundary" : ""}`}</title></line>)}
        {draft.markers.filter(m => inRange(m.startFrame, view)).map((m) => {
          const value = drag?.id === m.markerId ? drag.frame : m.startFrame;
          const x = position(value, view) * WIDTH;
          return <g key={m.markerId} className={`slice-marker ${m.locked ? "is-locked" : ""} ${selected === m.markerId ? "is-selected" : ""}`}
            role="slider" tabIndex={mutationDisabled ? -1 : 0} aria-label={`Boundary ${m.startFrame}`} aria-valuetext={`Frame ${value}`} aria-valuemin={0} aria-valuemax={Number(frame(draft.region.endExclusive) - frame(draft.region.startFrame) - 1n)} aria-valuenow={Number(frame(value) - frame(draft.region.startFrame))}
            onDoubleClick={e => e.stopPropagation()}
            onPointerDown={e => { if (mutationDisabled) return; e.preventDefault(); setSelected(m.markerId); dragRef.current = { id: m.markerId, frame: m.startFrame }; setDrag(dragRef.current); e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId); }}
            onKeyDown={e => {
              if (mutationDisabled || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
              e.preventDefault(); setSelected(m.markerId);
              const current = dragRef.current?.id === m.markerId ? dragRef.current.frame : m.startFrame;
              const next = frame(current) + (e.key === "ArrowRight" ? 1n : -1n) * (e.shiftKey ? 10n : 1n);
              if (next >= frame(draft.region.startFrame) && next < frame(draft.region.endExclusive)) {
                dragRef.current = { id: m.markerId, frame: next.toString() }; setDrag(dragRef.current);
              }
            }} onKeyUp={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) endDrag(); }} onBlur={endDrag}>
            <line x1={x} x2={x} y1="0" y2="160" /><rect x={x - 5} y="0" width="10" height="160" className="slice-hit-target" />
          </g>;
        })}
      </svg>
      <p className="slice-hint">Dashed: candidates · orange: draft · blue: fixed. Drag a draft boundary or use ←/→ (Shift: 10 frames). Double-click to insert.</p>
      <div className="slice-actions"><button disabled={mutationDisabled} onClick={() => void play(view)}>Play visible region</button><button disabled={!selectedMarker || mutationDisabled} onClick={() => { if (selectedMarker) void play(selectedMarker); }}>Play selected slice</button><button onClick={stop} disabled={!playing && !previewing}>Stop</button></div>
      <p className="slice-hint">Preview supports up to 30 seconds per region. Zoom in for longer slices.</p>
    </>
  ) : null;

  const editorBlock = readyId && draft ? (
    <>
      <p role="status">
        {proposing
          ? t("slicing.updatingCandidates")
          : proposal
            ? t("slicing.candidatesSummary", {
              count: proposal.candidateCount,
              suppressed: proposal.suppressedCount,
            })
            : t("slicing.candidatesUnavailable")}
      </p>
      {proposal?.candidateCount === 0 && <p>{t("slicing.noAttacksFound")}</p>}
      {proposal?.exceedsDraftLimit && <p role="alert">{t("slicing.exceedsDraftLimit")}</p>}
      {warnings.length > 0 && <details><summary>{warnings.length} candidate boundaries need review</summary><ul>{warnings.slice(0, PAGE).map(c => <li key={c.candidateId}>Frame {c.suggestedStartFrame}: {c.warnings.map(w => w === "LEFT_EDGE_TRUNCATED" ? "sound already active at file start" : w === "PRE_ROLL_CLIPPED" ? "pre-roll clipped by region" : "uncertain attack position").join(", ")}</li>)}</ul>{warnings.length > PAGE && <p>Showing the first {PAGE} warnings. Zoom into candidates to inspect their positions.</p>}</details>}
      <div className="slice-actions">
        <button disabled={mutationDisabled || proposing || !proposal || proposal.exceedsDraftLimit} onClick={() => { if (proposal) void edit({ kind: "acceptProposal", proposalId: proposal.proposalId }); }}>{t("slicing.applyCandidates")}</button>
        <button disabled={mutationDisabled || !draft.canUndo} onClick={() => void edit({ kind: "undo" })}>Undo</button><button disabled={mutationDisabled || !draft.canRedo} onClick={() => void edit({ kind: "redo" })}>Redo</button>
      </div>
      <p>{t("slicing.draftSummary", { count: draft.markers.length, revision: draft.revision })}</p>
      {draft.markers.length > 64 && <p className="slice-notice">{t("slicing.exceedsOtLimit")}</p>}
      <form className="slice-actions" onSubmit={e => { e.preventDefault(); try { frame(insertFrame); void edit({ kind: "insert", frame: insertFrame }); } catch (err) { setError(normalizeSliceError(err)); } }}>
        <label>Insert at frame<input aria-label="Insert at frame" inputMode="numeric" value={insertFrame} onChange={e => setInsertFrame(e.target.value)} disabled={mutationDisabled} /></label><button disabled={mutationDisabled}>Insert boundary</button>
      </form>
      <div className="slice-table"><table><thead><tr><th>Start frame</th><th>End (exclusive)</th><th>Fixed</th><th>Actions</th></tr></thead><tbody>
        {draft.markers.slice(page * PAGE, (page + 1) * PAGE).map(m => <MarkerRow key={`${m.markerId}:${m.startFrame}`} marker={m} disabled={mutationDisabled} selected={selected === m.markerId} onSelect={() => setSelected(m.markerId)} edit={edit} />)}
      </tbody></table></div>
      {draft.markers.length > PAGE && <div className="slice-actions"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous boundaries</button><span>Page {page + 1} / {Math.ceil(draft.markers.length / PAGE)}</span><button disabled={(page + 1) * PAGE >= draft.markers.length} onClick={() => setPage(p => p + 1)}>Next boundaries</button></div>}
      <p className="slice-notice">
        {t("slicing.exportNotice")}
        {job?.sampleRate === 48000 ? t("slicing.reanalyze48000") : ""}
      </p>
    </>
  ) : null;

  void narrowExpanded;
  const workbenchClass = [
    "slice-workbench",
    layout === "expanded" ? "slice-workbench--expanded" : "",
  ].filter(Boolean).join(" ");

  let body: ReactNode;
  if (layout === "expanded") {
    body = (
      <section className={workbenchClass} aria-label={t("slicing.ariaFor", { displayName })} data-testid="slice-workbench-expanded">
        <div className="slice-workbench__expanded-center">
          {preamble}
          {detectionFieldset}
          {waveformBlock}
        </div>
        <div className="slice-workbench__expanded-aside">
          {editorBlock}
        </div>
      </section>
    );
  } else {
    body = (
      <section className={workbenchClass} aria-label={t("slicing.ariaFor", { displayName })} data-testid="slice-workbench-compact">
        {preamble}
        {detectionFieldset}
        {waveformBlock}
        {editorBlock}
      </section>
    );
  }

  if (hostElement) {
    return createPortal(body, hostElement);
  }
  return body;
}

function MarkerRow({ marker, disabled, selected, onSelect, edit }: {
  marker: SliceMarker; disabled: boolean; selected: boolean; onSelect: () => void;
  edit: (input: SliceEdit) => Promise<void>;
}) {
  const [value, setValue] = useState(marker.startFrame);
  function commit() {
    if (value !== marker.startFrame) {
      void edit({ kind: "move", markerId: marker.markerId, frame: value });
      setValue(marker.startFrame);
    }
  }
  return <tr className={selected ? "is-selected" : ""}>
    <td><input aria-label={`Start frame ${marker.markerId}`} value={value} inputMode="numeric" disabled={disabled} onFocus={onSelect} onChange={e => setValue(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setValue(marker.startFrame); }} /></td>
    <td>{marker.endExclusive}</td>
    <td><input aria-label={`Fixed ${marker.startFrame}`} type="checkbox" checked={marker.locked} disabled={disabled} onChange={e => void edit({ kind: "setLock", markerId: marker.markerId, locked: e.target.checked })} /></td>
    <td><button disabled={disabled} onClick={onSelect}>Select</button><button disabled={disabled} aria-label={`Delete boundary ${marker.startFrame}`} onClick={() => void edit({ kind: "delete", markerId: marker.markerId })}>Delete</button></td>
  </tr>;
}
