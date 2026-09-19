import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SliceApi, SliceDraft, SliceJob, SliceProposal } from "../../api/slices";
import { writeStoredLocaleId } from "../../i18n/applyLocale";
import { useLocale } from "../../i18n/LocaleProvider";
import { tEn, tJa } from "../../i18n/testStrings";
import { withLocaleProvider } from "../../i18n/testUtils";
import { SliceWorkbench } from "./SliceWorkbench";

const region = { startFrame: "0", endExclusive: "44100" };
const ready: SliceJob = {
  jobId: "job-1",
  phase: "ready",
  error: null,
  sampleRate: 44100,
  channels: 1,
  frameCount: "44100",
  region,
};
const empty: SliceDraft = {
  revision: 0,
  region,
  markers: [],
  canUndo: false,
  canRedo: false,
};
const proposal: SliceProposal = {
  proposalId: "proposal-1",
  expectedRevision: 0,
  candidateCount: 1,
  suppressedCount: 0,
  exceedsDraftLimit: false,
  candidates: [{
    candidateId: "candidate-1",
    noveltyPeakFrame: "990",
    estimatedAttackFrame: "1000",
    suggestedStartFrame: "956",
    strength: 0.7,
    bandScores: [4, 5, 3],
    thresholdMargin: 2,
    uncertainty: { startFrame: "950", endExclusive: "1050" },
    warnings: [],
  }],
};
function client(): SliceApi {
  return {
    start: vi.fn().mockResolvedValue(ready),
    status: vi.fn().mockResolvedValue(ready),
    cancel: vi.fn().mockResolvedValue(undefined),
    draft: vi.fn().mockResolvedValue(empty),
    propose: vi.fn().mockResolvedValue(proposal),
    edit: vi.fn().mockResolvedValue({
      ...empty,
      revision: 1,
      canUndo: true,
      markers: [{
        markerId: "candidate-1",
        startFrame: "956",
        endExclusive: "44100",
        manual: false,
        locked: false,
      }],
    }),
    waveform: vi.fn().mockResolvedValue({ range: region, peaks: [[[-0.5, 0.5]]] }),
    preview: vi.fn(),
    readPreview: vi.fn(),
  };
}
function mount(
  api: SliceApi,
  extra: {
    librarySelectionRange?: { startFrame: string; endFrameExclusive: string } | null;
    librarySourceSampleRate?: number | null;
    onRequestStopLibraryPlayback?: () => void;
    withLocaleToggle?: boolean;
  } = {},
) {
  const workbench = (
    <SliceWorkbench
      rootId="root-1"
      fileInstanceId="file-1"
      displayName="loop.wav"
      api={api}
      librarySelectionRange={extra.librarySelectionRange ?? null}
      librarySourceSampleRate={extra.librarySourceSampleRate ?? null}
      onRequestStopLibraryPlayback={extra.onRequestStopLibraryPlayback}
    />
  );
  if (!extra.withLocaleToggle) {
    return render(withLocaleProvider(workbench));
  }
  function LocaleHarness() {
    const { localeId, setLocaleId } = useLocale();
    return (
      <>
        <button
          type="button"
          aria-label="Toggle locale"
          onClick={() => setLocaleId(localeId === "ja" ? "en" : "ja")}
        />
        {workbench}
      </>
    );
  }
  return render(withLocaleProvider(<LocaleHarness />));
}
async function detect() {
  fireEvent.click(screen.getByRole("button", { name: tJa("slicing.detectAttacks") }));
  await waitFor(() => expect(
    screen.getByRole("button", { name: tJa("slicing.applyCandidates") }),
  ).toBeEnabled());
}

describe("attack slicing workbench", () => {
  beforeEach(() => {
    writeStoredLocaleId("ja");
  });

  it("requires explicit analysis and candidate acceptance before saving a draft", async () => {
    const api = client();
    mount(api);
    expect(api.start).not.toHaveBeenCalled();
    await detect();
    expect(api.start).toHaveBeenCalledWith("root-1", "file-1", undefined);
    expect(api.edit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(
      "root-1",
      "job-1",
      0,
      { kind: "acceptProposal", proposalId: "proposal-1" },
    ));
    expect(await screen.findByDisplayValue("956")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });
  it("reuses the analysis for parameter changes without saving automatically", async () => {
    const api = client();
    mount(api);
    await detect();
    fireEvent.change(screen.getByLabelText(tJa("slicing.preRollMs")), { target: { value: "2" } });
    await waitFor(() => expect(api.propose).toHaveBeenLastCalledWith(
      "root-1",
      "job-1",
      0,
      expect.objectContaining({ preRollUs: 2000 }),
    ));
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.edit).not.toHaveBeenCalled();
  });
  it("shows empty detection and refuses to silently truncate an oversized proposal", async () => {
    const api = client();
    vi.mocked(api.propose).mockResolvedValue({ ...proposal, candidateCount: 0, candidates: [] });
    mount(api);
    await detect();
    expect(screen.getByText(tJa("slicing.noAttacksFound"))).toBeInTheDocument();
    expect(api.edit).not.toHaveBeenCalled();
    vi.mocked(api.propose).mockResolvedValue({ ...proposal, candidateCount: 4100, exceedsDraftLimit: true });
    fireEvent.change(screen.getByLabelText(tJa("slicing.preRollMs")), { target: { value: "2" } });
    expect(await screen.findByText(tJa("slicing.exceedsDraftLimit"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tJa("slicing.applyCandidates") })).toBeDisabled();
  });
  it("cancels a late start when the selected file changes and never publishes that result", async () => {
    const api = client();
    let finish!: (job: SliceJob) => void;
    vi.mocked(api.start).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const screenView = mount(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.detectAttacks") }));
    screenView.rerender(withLocaleProvider(
      <SliceWorkbench rootId="root-1" fileInstanceId="file-2" displayName="other.wav" api={api} />,
    ));
    finish(ready);
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("root-1", "job-1"));
    expect(api.draft).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: tJa("slicing.applyCandidates") })).not.toBeInTheDocument();
  });
  it("reloads conflicts without replaying the user's edit", async () => {
    const api = client();
    vi.mocked(api.edit).mockRejectedValue({
      code: "DRAFT_CONFLICT",
      message: "The draft changed; reload it before editing.",
    });
    mount(api);
    await detect();
    vi.mocked(api.draft).mockResolvedValue({ ...empty, revision: 4 });
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("slicing.error.DRAFT_CONFLICT"));
    await waitFor(() => expect(screen.getByText(/revision 4/)).toBeInTheDocument());
    expect(api.edit).toHaveBeenCalledTimes(1);
  });
  it("passes a non-zero library selection to start with exclusive end mapping", async () => {
    const api = client();
    mount(api, {
      librarySelectionRange: { startFrame: "22050", endFrameExclusive: "44100" },
    });
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.analyzeSelectedRange") }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("root-1", "file-1", {
      startFrame: "22050",
      endExclusive: "44100",
    }));
  });

  it("shows M7 Range A preview selection and sends the same frames on analyze", async () => {
    const api = client();
    mount(api, {
      librarySelectionRange: { startFrame: "44100", endFrameExclusive: "132300" },
      librarySourceSampleRate: 44100,
    });
    expect(screen.getByText(tJa("slicing.analysisRegionFrames", {
      start: "44100",
      end: "132300",
    }))).toBeInTheDocument();
    expect(screen.getByLabelText(tJa("slicing.regionStart"))).toHaveValue("");
    expect(screen.getByLabelText(tJa("slicing.regionEnd"))).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.analyzeSelectedRange") }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("root-1", "file-1", {
      startFrame: "44100",
      endExclusive: "132300",
    }));
  });

  it("shows preview selection none when library range is unset", () => {
    const api = client();
    mount(api);
    expect(screen.getByText(tJa("slicing.previewSelectionNone"))).toBeInTheDocument();
  });

  it("keeps preview selection visible across locale toggle without starting analysis", () => {
    const api = client();
    mount(api, {
      librarySelectionRange: { startFrame: "44100", endFrameExclusive: "132300" },
      withLocaleToggle: true,
    });
    expect(screen.getByText(tJa("slicing.analysisRegionFrames", {
      start: "44100",
      end: "132300",
    }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle locale" }));
    expect(api.start).not.toHaveBeenCalled();
    expect(screen.getByText(tEn("slicing.analysisRegionFrames", {
      start: "44100",
      end: "132300",
    }))).toBeInTheDocument();
  });
  it("does not start analysis when the library selection changes without a button press", async () => {
    const api = client();
    const view = mount(api, {
      librarySelectionRange: { startFrame: "1000", endFrameExclusive: "2000" },
    });
    expect(api.start).not.toHaveBeenCalled();
    view.rerender(withLocaleProvider(
      <SliceWorkbench
        rootId="root-1"
        fileInstanceId="file-1"
        displayName="loop.wav"
        api={api}
        librarySelectionRange={{ startFrame: "3000", endFrameExclusive: "4000" }}
      />,
    ));
    expect(api.start).not.toHaveBeenCalled();
  });
  it("disables analyze selected range without a committed library geometry range", () => {
    const api = client();
    mount(api);
    expect(screen.getByRole("button", { name: tJa("slicing.analyzeSelectedRange") })).toBeDisabled();
  });
  it("stops library playback before starting analysis from the waveform selection", async () => {
    const api = client();
    const stopLibrary = vi.fn();
    mount(api, {
      librarySelectionRange: { startFrame: "0", endFrameExclusive: "44100" },
      onRequestStopLibraryPlayback: stopLibrary,
    });
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.analyzeSelectedRange") }));
    expect(stopLibrary).toHaveBeenCalled();
    await waitFor(() => expect(api.start).toHaveBeenCalled());
  });
  it("surfaces structured region mismatch errors from the backend", async () => {
    const api = client();
    vi.mocked(api.start).mockRejectedValue({
      code: "ANALYSIS_REGION_MISMATCH",
      message: "existing draft uses a different analysis region",
    });
    mount(api, {
      librarySelectionRange: { startFrame: "0", endFrameExclusive: "44100" },
    });
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.analyzeSelectedRange") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("slicing.error.ANALYSIS_REGION_MISMATCH"));
  });

  it("shows INVALID_SLICE_REQUEST summary and backend diagnostic detail for slice preview limits", async () => {
    const api = client();
    vi.mocked(api.preview).mockRejectedValue({
      code: "INVALID_SLICE_REQUEST",
      message: "preview exceeds 30 seconds or 16 MiB",
    });
    mount(api);
    await detect();
    fireEvent.click(screen.getByRole("button", { name: "Play visible region" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      tJa("slicing.error.genericDetail", { detail: "preview exceeds 30 seconds or 16 MiB" }),
    );
    expect(screen.queryByText(tJa("waveform.error.rangePreviewLimit"))).not.toBeInTheDocument();
  });

  it("keeps view and insert frame across locale changes without refetching draft data", async () => {
    const api = client();
    mount(api, { withLocaleToggle: true });
    await detect();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(vi.mocked(api.waveform).mock.calls.length).toBeGreaterThan(1));
    const draftCalls = vi.mocked(api.draft).mock.calls.length;
    const proposeCalls = vi.mocked(api.propose).mock.calls.length;
    const waveformCalls = vi.mocked(api.waveform).mock.calls.length;

    const framesBefore = screen.getByText(/Frames \[/).textContent;
    fireEvent.change(screen.getByLabelText("Insert at frame"), { target: { value: "1200" } });

    fireEvent.click(screen.getByRole("button", { name: "Toggle locale" }));
    expect(await screen.findByRole("heading", { name: tEn("slicing.heading") })).toBeInTheDocument();
    expect(screen.getByText(framesBefore!)).toBeInTheDocument();
    expect(screen.getByLabelText("Insert at frame")).toHaveValue("1200");
    expect(vi.mocked(api.draft).mock.calls.length).toBe(draftCalls);
    expect(vi.mocked(api.propose).mock.calls.length).toBe(proposeCalls);
    expect(vi.mocked(api.waveform).mock.calls.length).toBe(waveformCalls);
  });

  it("retranslates displayed errors on locale change without extra IPC", async () => {
    const api = client();
    vi.mocked(api.start).mockRejectedValue({
      code: "INVALID_SLICE_REQUEST",
      message: "history is empty",
    });
    mount(api, { withLocaleToggle: true });
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.detectAttacks") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      tJa("slicing.error.genericDetail", { detail: "history is empty" }),
    );
    const startCalls = vi.mocked(api.start).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Toggle locale" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      tEn("slicing.error.genericDetail", { detail: "history is empty" }),
    );
    expect(vi.mocked(api.start).mock.calls.length).toBe(startCalls);
  });

  it("renders expanded layout regions without remounting session state", async () => {
    const api = client();
    const view = mount(api);
    await detect();
    view.rerender(withLocaleProvider(
      <SliceWorkbench
        rootId="root-1"
        fileInstanceId="file-1"
        displayName="loop.wav"
        api={api}
        layout="expanded"
      />,
    ));
    expect(screen.getByTestId("slice-workbench-expanded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tJa("slicing.applyCandidates") })).toBeEnabled();
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("portals into a host element when hostElement is provided", async () => {
    const api = client();
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(withLocaleProvider(
      <SliceWorkbench
        rootId="root-1"
        fileInstanceId="file-1"
        displayName="loop.wav"
        api={api}
        hostElement={host}
      />,
    ));
    expect(host.querySelector("[data-testid='slice-workbench-compact']")).not.toBeNull();
    host.remove();
  });

  it("ignores a late start failure after analysis was superseded", async () => {
    const api = client();
    let rejectStart!: (error: unknown) => void;
    vi.mocked(api.start).mockImplementation(
      () => new Promise((_resolve, reject) => { rejectStart = reject; }),
    );
    mount(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.detectAttacks") }));
    await waitFor(() => expect(
      screen.getByRole("button", { name: tJa("slicing.cancelAnalysis") }),
    ).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.cancelAnalysis") }));
    rejectStart({
      code: "INVALID_SLICE_REQUEST",
      message: "stale failure",
    });
    await Promise.resolve();
    expect(screen.queryByText("stale failure")).not.toBeInTheDocument();
  });

  it("blocks stale candidate apply after ANALYSIS_NOT_FOUND and keeps the draft", async () => {
    const api = client();
    vi.mocked(api.edit).mockRejectedValueOnce({
      code: "ANALYSIS_NOT_FOUND",
      message: "analysis or preview is unavailable",
    });
    mount(api);
    await detect();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("slicing.error.ANALYSIS_NOT_FOUND"));
    expect(screen.getByText(tJa("slicing.reanalyzeRequired"))).toBeInTheDocument();
    expect(screen.getByText(tJa("slicing.draftSummary", { count: 0, revision: 0 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tJa("slicing.applyCandidates") })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("treats ANALYSIS_EXPIRED like a dead session without clearing the draft", async () => {
    const api = client();
    vi.mocked(api.edit).mockRejectedValueOnce({
      code: "ANALYSIS_EXPIRED",
      message: "the analysis session has expired",
    });
    mount(api);
    await detect();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("slicing.error.ANALYSIS_EXPIRED"));
    expect(screen.getByText(tJa("slicing.reanalyzeRequired"))).toBeInTheDocument();
    expect(screen.getByText(tJa("slicing.draftSummary", { count: 0, revision: 0 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tJa("slicing.applyCandidates") })).toBeDisabled();
  });

  it("recovers with explicit re-analysis after the session becomes invalid", async () => {
    const api = client();
    vi.mocked(api.start)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ ...ready, jobId: "job-2" });
    vi.mocked(api.edit).mockRejectedValueOnce({
      code: "ANALYSIS_NOT_FOUND",
      message: "analysis or preview is unavailable",
    });
    mount(api);
    await detect();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    expect(await screen.findByText(tJa("slicing.reanalyzeRequired"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.analyzeAgain") }));
    await waitFor(() => expect(
      screen.getByRole("button", { name: tJa("slicing.applyCandidates") }),
    ).toBeEnabled());
    expect(screen.queryByText(tJa("slicing.reanalyzeRequired"))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(
      "root-1",
      "job-2",
      0,
      { kind: "acceptProposal", proposalId: "proposal-1" },
    ));
  });

  it("ignores a late proposal from a superseded analysis session", async () => {
    const api = client();
    let finishPropose!: (value: SliceProposal) => void;
    vi.mocked(api.propose).mockImplementationOnce(
      () => new Promise((resolve) => { finishPropose = resolve; }),
    );
    vi.mocked(api.start)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ ...ready, jobId: "job-2" });
    mount(api);
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.detectAttacks") }));
    await waitFor(() => expect(api.propose).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.analyzeAgain") }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(
      screen.getByRole("button", { name: tJa("slicing.applyCandidates") }),
    ).toBeEnabled());
    finishPropose({ ...proposal, proposalId: "stale-proposal" });
    await Promise.resolve();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(
      "root-1",
      "job-2",
      0,
      { kind: "acceptProposal", proposalId: "proposal-1" },
    ));
    expect(api.edit).not.toHaveBeenCalledWith(
      "root-1",
      "job-2",
      0,
      { kind: "acceptProposal", proposalId: "stale-proposal" },
    );
  });

  it("does not treat a missing preview token as a dead analysis session", async () => {
    const api = client();
    vi.mocked(api.preview).mockResolvedValue({
      previewToken: "tok-1",
      sampleRate: 44100,
      channels: 1,
      frameCount: "1",
      byteLength: 4,
    });
    vi.mocked(api.readPreview).mockRejectedValue({
      code: "ANALYSIS_NOT_FOUND",
      message: "analysis or preview is unavailable",
    });
    mount(api);
    await detect();
    fireEvent.click(screen.getByRole("button", { name: "Play visible region" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tJa("slicing.error.ANALYSIS_NOT_FOUND"));
    expect(screen.queryByText(tJa("slicing.reanalyzeRequired"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: tJa("slicing.applyCandidates") })).toBeEnabled();
  });

  it("keeps an invalid analysis session across locale change without extra IPC", async () => {
    const api = client();
    vi.mocked(api.edit).mockRejectedValueOnce({
      code: "ANALYSIS_NOT_FOUND",
      message: "analysis or preview is unavailable",
    });
    mount(api, { withLocaleToggle: true });
    await detect();
    fireEvent.click(screen.getByRole("button", { name: tJa("slicing.applyCandidates") }));
    expect(await screen.findByText(tJa("slicing.reanalyzeRequired"))).toBeInTheDocument();
    const startCalls = vi.mocked(api.start).mock.calls.length;
    const draftCalls = vi.mocked(api.draft).mock.calls.length;
    const proposeCalls = vi.mocked(api.propose).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Toggle locale" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tEn("slicing.error.ANALYSIS_NOT_FOUND"));
    expect(screen.getByText(tEn("slicing.reanalyzeRequired"))).toBeInTheDocument();
    expect(screen.getByText(tEn("slicing.draftSummary", { count: 0, revision: 0 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tEn("slicing.applyCandidates") })).toBeDisabled();
    expect(vi.mocked(api.start).mock.calls.length).toBe(startCalls);
    expect(vi.mocked(api.draft).mock.calls.length).toBe(draftCalls);
    expect(vi.mocked(api.propose).mock.calls.length).toBe(proposeCalls);
  });
});
