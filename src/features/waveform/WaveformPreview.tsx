import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  audioApi,
  type AudioApi,
  type AudioPreviewBytes,
  type AudioWaveformWindow,
  type WaveformPeak,
} from "../../api";
import { Button } from "../../design-system";
import {
  classifyFrameRangeError,
  frameRangeErrorMessageKey,
} from "../../i18n/frameRangeErrors";
import {
  formatFileDurationLabel,
  formatFrameSpanDurationLabel,
} from "../../i18n/formatSpanDuration";
import { useTranslate, type TranslateFn } from "../../i18n";
import {
  defaultLibraryPreviewEndFrame,
  validateFrameRange,
  validateGeometryFrameRange,
} from "./frameMath";
import {
  readPlotContainerWidthCss,
  targetPointsFromPlotWidthCss,
  WAVEFORM_QUERY_DEBOUNCE_MS,
} from "./waveformTargetPoints";
import {
  frameRangesEqual,
  framesFromDragPixels,
  fullFileViewport,
  panViewport,
  selectionRectInViewBox,
  viewportAroundRange,
  viewportLength,
  waveformQueryKey,
  zoomViewport,
  type ViewportRange,
} from "./viewportRange";
import type { LibraryGeometryNotification } from "./libraryGeometrySelection";
import "./WaveformPreview.css";

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 140;

export type LibraryCommittedGeometryRange = ViewportRange;

interface WaveformPreviewProps {
  rootId: string;
  assetId: string;
  displayName: string;
  fileInstanceId?: string;
  /** Bumped when catalog selection identity changes; tags geometry notifications. */
  geometrySelectionGeneration?: number;
  api?: AudioApi;
  /** Override debounce for tests; production uses WAVEFORM_QUERY_DEBOUNCE_MS. */
  queryDebounceMs?: number;
  /** Fires when the committed geometry range changes (not on every keystroke). */
  onCommittedGeometryRangeChange?: (
    range: LibraryCommittedGeometryRange | null,
    notification?: LibraryGeometryNotification,
  ) => void;
  /** Increment to stop range preview playback from a sibling control (e.g. slice analysis). */
  stopPlaybackToken?: number;
  /** When false, plot width is frozen so hidden tabs do not re-query waveform IPC. */
  layoutVisible?: boolean;
  /** True while head preview or range playback is active. */
  onPlaybackActivityChange?: (active: boolean) => void;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function toArrayBuffer(bytes: AudioPreviewBytes): ArrayBuffer {
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
}

export function waveformChannelPath(peaks: WaveformPeak[], pointCount: number): string {
  if (peaks.length === 0) return "";
  const xScale = VIEWBOX_WIDTH / pointCount;
  const center = VIEWBOX_HEIGHT / 2;
  return peaks
    .map((peak, index) => {
      const x = (index + 0.5) * xScale;
      const top = center - Math.max(-1, Math.min(1, peak.max)) * center;
      const bottom = center - Math.max(-1, Math.min(1, peak.min)) * center;
      return `M${x.toFixed(2)} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
    })
    .join("");
}

/** @deprecated Use waveformChannelPath with v2 channel peaks. */
export function waveformPath(window: AudioWaveformWindow): string {
  const primary = window.channelPeaks[0] ?? [];
  return waveformChannelPath(primary, primary.length);
}

function formatUserFacingError(error: unknown, t: TranslateFn): string {
  const code = classifyFrameRangeError(error);
  if (code !== null) {
    return t(frameRangeErrorMessageKey(code));
  }
  const detail = errorMessage(error);
  if (detail === "Preview response failed validation.") {
    return t("waveform.error.previewValidation");
  }
  return t("waveform.error.detail", { detail });
}

export function WaveformPreview({
  rootId,
  assetId,
  displayName,
  fileInstanceId,
  geometrySelectionGeneration = 0,
  api = audioApi,
  queryDebounceMs = WAVEFORM_QUERY_DEBOUNCE_MS,
  onCommittedGeometryRangeChange,
  stopPlaybackToken = 0,
  layoutVisible = true,
  onPlaybackActivityChange,
}: WaveformPreviewProps) {
  const t = useTranslate();
  const [waveform, setWaveform] = useState<AudioWaveformWindow | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [rangeStartFrame, setRangeStartFrame] = useState("0");
  const [rangeEndFrameExclusive, setRangeEndFrameExclusive] = useState("");
  const [rangeInvalid, setRangeInvalid] = useState<string | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangePlaying, setRangePlaying] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const rangeRequest = useRef(0);
  const waveformRequest = useRef(0);
  const plotContainerRef = useRef<HTMLDivElement | null>(null);
  const frozenPlotWidthRef = useRef(0);
  const lastQueryKeyRef = useRef<string | null>(null);
  const applyRangeOnNextWaveformRef = useRef(true);
  const debouncedTargetPointsRef = useRef<number | null>(null);
  const debouncedViewportRef = useRef<ViewportRange | null>(null);
  const dragSessionRef = useRef<{
    generation: number;
    viewport: ViewportRange;
    widthPx: number;
    startX: number;
    currentX: number;
  } | null>(null);
  const dragGenerationRef = useRef(0);
  const [plotWidthCss, setPlotWidthCss] = useState(0);
  const [debouncedTargetPoints, setDebouncedTargetPoints] = useState<number | null>(null);
  const [viewportRange, setViewportRange] = useState<ViewportRange | null>(null);
  const [debouncedViewport, setDebouncedViewport] = useState<ViewportRange | null>(null);
  const [dragDraftRange, setDragDraftRange] = useState<ViewportRange | null>(null);
  const [fileMetadata, setFileMetadata] = useState<{
    frameCount: string;
    sampleRate: number;
    channels: number;
  } | null>(null);
  debouncedTargetPointsRef.current = debouncedTargetPoints;
  debouncedViewportRef.current = debouncedViewport;
  const rangeAudioRef = useRef<HTMLAudioElement | null>(null);
  const headAudioRef = useRef<HTMLAudioElement | null>(null);
  const rangeObjectUrl = useRef<string | null>(null);
  const rangeListenersRef = useRef<{
    element: HTMLAudioElement;
    onEnded: () => void;
    onError: () => void;
  } | null>(null);
  const selectionRef = useRef({ rootId, assetId });
  selectionRef.current = { rootId, assetId };

  function isCurrentRangeRequest(
    request: number,
    target: { rootId: string; assetId: string },
  ): boolean {
    return (
      rangeRequest.current === request
      && selectionRef.current.rootId === target.rootId
      && selectionRef.current.assetId === target.assetId
    );
  }

  const detachRangeListeners = useCallback(() => {
    const attached = rangeListenersRef.current;
    if (attached === null) return;
    attached.element.removeEventListener("ended", attached.onEnded);
    attached.element.removeEventListener("error", attached.onError);
    rangeListenersRef.current = null;
  }, []);

  const stopRangePlayback = useCallback(() => {
    detachRangeListeners();
    const element = rangeAudioRef.current;
    if (element !== null) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    if (rangeObjectUrl.current !== null) {
      URL.revokeObjectURL(rangeObjectUrl.current);
      rangeObjectUrl.current = null;
    }
    setRangePlaying(false);
  }, [detachRangeListeners]);

  const pauseHeadPreview = useCallback(() => {
    headAudioRef.current?.pause();
  }, []);

  const stopSelectedRange = useCallback(() => {
    rangeRequest.current += 1;
    stopRangePlayback();
    setRangeLoading(false);
    setRangeError(null);
  }, [stopRangePlayback]);

  useLayoutEffect(() => {
    const element = plotContainerRef.current;
    if (element === null) {
      return;
    }

    const publishWidth = (widthCss: number) => {
      if (!layoutVisible) {
        if (widthCss > 0) frozenPlotWidthRef.current = widthCss;
        return;
      }
      const next = widthCss > 0 ? widthCss : frozenPlotWidthRef.current;
      if (next > 0) frozenPlotWidthRef.current = next;
      setPlotWidthCss(next);
    };

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        publishWidth(entry?.contentRect.width ?? 0);
      });
      observer.observe(element);
      publishWidth(readPlotContainerWidthCss(element));
      return () => observer.disconnect();
    }

    const measure = () => publishWidth(readPlotContainerWidthCss(element));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [layoutVisible]);

  useEffect(() => {
    if (!layoutVisible) return;
    const element = plotContainerRef.current;
    if (element === null) return;
    const widthCss = readPlotContainerWidthCss(element);
    if (widthCss > 0) {
      frozenPlotWidthRef.current = widthCss;
      setPlotWidthCss(widthCss);
    }
  }, [layoutVisible]);

  useEffect(() => {
    onPlaybackActivityChange?.(previewing || rangePlaying || rangeLoading);
  }, [onPlaybackActivityChange, previewing, rangePlaying, rangeLoading]);

  useEffect(() => {
    const immediate = targetPointsFromPlotWidthCss(plotWidthCss);
    if (immediate === null) {
      setDebouncedTargetPoints(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedTargetPoints(immediate);
    }, queryDebounceMs);
    return () => window.clearTimeout(timer);
  }, [plotWidthCss, queryDebounceMs]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedViewport(viewportRange);
    }, queryDebounceMs);
    return () => window.clearTimeout(timer);
  }, [viewportRange, queryDebounceMs]);

  useEffect(() => {
    dragGenerationRef.current += 1;
    dragSessionRef.current = null;
    setDragDraftRange(null);
  }, [viewportRange, assetId, rootId]);

  useEffect(() => {
    if (debouncedTargetPoints === null) {
      lastQueryKeyRef.current = null;
    }
  }, [debouncedTargetPoints]);

  useEffect(() => {
    lastQueryKeyRef.current = null;
    setWaveform(null);
    setWaveformError(null);
    setViewportRange(null);
    setDebouncedViewport(null);
    setFileMetadata(null);
    applyRangeOnNextWaveformRef.current = true;
  }, [api, assetId, rootId]);

  useEffect(() => {
    if (debouncedTargetPoints === null) {
      return;
    }
    const requestedRange = debouncedViewport;
    const queryKey = requestedRange === null
      ? `${rootId}\0${assetId}\0bootstrap\0${debouncedTargetPoints}`
      : waveformQueryKey(rootId, assetId, requestedRange, debouncedTargetPoints);
    if (lastQueryKeyRef.current === queryKey) {
      return;
    }
    lastQueryKeyRef.current = queryKey;

    const requestId = waveformRequest.current + 1;
    waveformRequest.current = requestId;
    const requestedTargetPoints = debouncedTargetPoints;
    const requestedRootId = rootId;
    const requestedAssetId = assetId;
    const requestedViewport = requestedRange;

    api
      .queryWaveform(requestedRootId, requestedAssetId, {
        range: requestedViewport,
        targetPoints: requestedTargetPoints,
      })
      .then(
        (nextWaveform) => {
          if (waveformRequest.current !== requestId) {
            return;
          }
          if (selectionRef.current.rootId !== requestedRootId) {
            return;
          }
          if (selectionRef.current.assetId !== requestedAssetId) {
            return;
          }
          if (debouncedTargetPointsRef.current !== requestedTargetPoints) {
            return;
          }
          const currentViewport = debouncedViewportRef.current;
          if (requestedViewport === null) {
            if (currentViewport !== null) {
              return;
            }
            if (!frameRangesEqual(nextWaveform.range, fullFileViewport(nextWaveform.frameCount))) {
              return;
            }
          } else if (
            currentViewport === null
            || !frameRangesEqual(nextWaveform.range, currentViewport)
          ) {
            return;
          }
          setWaveform(nextWaveform);
          setWaveformError(null);
          setFileMetadata({
            frameCount: nextWaveform.frameCount,
            sampleRate: nextWaveform.sampleRate,
            channels: nextWaveform.channels,
          });
          setViewportRange((prev) => prev ?? fullFileViewport(nextWaveform.frameCount));
          if (applyRangeOnNextWaveformRef.current) {
            applyRangeOnNextWaveformRef.current = false;
            setRangeStartFrame("0");
            setRangeEndFrameExclusive(defaultLibraryPreviewEndFrame(
              nextWaveform.frameCount,
              nextWaveform.sampleRate,
              nextWaveform.channels,
            ));
            setRangeInvalid(null);
          }
        },
        (error) => {
          if (waveformRequest.current !== requestId) {
            return;
          }
          if (selectionRef.current.rootId !== requestedRootId) {
            return;
          }
          if (selectionRef.current.assetId !== requestedAssetId) {
            return;
          }
          if (debouncedTargetPointsRef.current !== requestedTargetPoints) {
            return;
          }
          lastQueryKeyRef.current = null;
          setWaveformError(errorMessage(error));
        },
      );

    return () => {
      waveformRequest.current += 1;
    };
  }, [api, assetId, debouncedTargetPoints, debouncedViewport, rootId]);

  useEffect(() => () => {
    if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => () => {
    previewRequest.current += 1;
    rangeRequest.current += 1;
    stopRangePlayback();
  }, [stopRangePlayback]);

  useEffect(() => {
    previewRequest.current += 1;
    rangeRequest.current += 1;
    setPreviewUrl(null);
    setPreviewError(null);
    setTruncated(false);
    setRangeStartFrame("0");
    setRangeEndFrameExclusive("");
    setRangeInvalid(null);
    setRangeError(null);
    setRangeLoading(false);
    setPreviewing(false);
    setViewportRange(null);
    setDebouncedViewport(null);
    setFileMetadata(null);
    stopRangePlayback();
  }, [assetId, rootId, stopRangePlayback]);

  useEffect(() => {
    if (fileMetadata === null) return;
    try {
      validateFrameRange(
        rangeStartFrame,
        rangeEndFrameExclusive,
        fileMetadata.frameCount,
        fileMetadata.sampleRate,
        fileMetadata.channels,
      );
      setRangeInvalid(null);
    } catch (error) {
      setRangeInvalid(errorMessage(error));
    }
  }, [fileMetadata, rangeEndFrameExclusive, rangeStartFrame]);

  const axisViewport = debouncedViewport ?? viewportRange;

  const peaksReady = useMemo(() => {
    if (waveform === null || axisViewport === null || debouncedTargetPoints === null) {
      return false;
    }
    return frameRangesEqual(waveform.range, axisViewport);
  }, [axisViewport, debouncedTargetPoints, waveform]);

  const committedGeometryRange = useMemo((): ViewportRange | null => {
    if (fileMetadata === null || rangeEndFrameExclusive === "") {
      return null;
    }
    try {
      validateGeometryFrameRange(
        rangeStartFrame,
        rangeEndFrameExclusive,
        fileMetadata.frameCount,
      );
      return {
        startFrame: rangeStartFrame,
        endFrameExclusive: rangeEndFrameExclusive,
      };
    } catch {
      return null;
    }
  }, [fileMetadata, rangeEndFrameExclusive, rangeStartFrame]);

  useEffect(() => {
    if (onCommittedGeometryRangeChange === undefined) return;
    if (fileInstanceId === undefined) {
      onCommittedGeometryRangeChange(committedGeometryRange);
      return;
    }
    onCommittedGeometryRangeChange(committedGeometryRange, {
      rootId,
      assetId,
      fileInstanceId,
      selectionGeneration: geometrySelectionGeneration,
      range: committedGeometryRange,
    });
  }, [
    committedGeometryRange,
    onCommittedGeometryRangeChange,
    rootId,
    assetId,
    fileInstanceId,
    geometrySelectionGeneration,
  ]);

  useEffect(() => {
    stopSelectedRange();
  }, [stopPlaybackToken, stopSelectedRange]);

  const committedSelection = committedGeometryRange;

  const highlightSelection = dragDraftRange ?? committedSelection;

  const selectionHighlight = useMemo(() => {
    if (!peaksReady || highlightSelection === null || axisViewport === null) {
      return null;
    }
    return selectionRectInViewBox(highlightSelection, axisViewport, VIEWBOX_WIDTH);
  }, [axisViewport, highlightSelection, peaksReady]);

  const channelPaths = useMemo(() => {
    if (!peaksReady || waveform === null) return [];
    return waveform.channelPeaks.map((channel) =>
      waveformChannelPath(channel, channel.length),
    );
  }, [peaksReady, waveform]);

  const durationLabel = useMemo(() => {
    if (fileMetadata === null) return null;
    return formatFileDurationLabel(fileMetadata.frameCount, fileMetadata.sampleRate, t);
  }, [fileMetadata, t]);

  const rangeDurationHint = useMemo(() => {
    if (committedGeometryRange === null || fileMetadata === null) return null;
    try {
      validateGeometryFrameRange(
        rangeStartFrame,
        rangeEndFrameExclusive,
        fileMetadata.frameCount,
      );
    } catch {
      return null;
    }
    return formatFrameSpanDurationLabel(
      rangeStartFrame,
      rangeEndFrameExclusive,
      fileMetadata.sampleRate,
      t,
    );
  }, [committedGeometryRange, fileMetadata, rangeEndFrameExclusive, rangeStartFrame, t]);

  const navigationDisabled = fileMetadata === null
    || viewportLength(axisViewport ?? { startFrame: "0", endFrameExclusive: "0" }) <= 0n;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dragSessionRef.current = null;
      setDragDraftRange(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function beginRangeEdit() {
    stopSelectedRange();
  }

  function commitDragSelection(session: NonNullable<typeof dragSessionRef.current>) {
    const range = framesFromDragPixels(
      session.viewport,
      session.widthPx,
      session.startX,
      session.currentX,
    );
    if (range === null) {
      return;
    }
    setRangeStartFrame(range.startFrame);
    setRangeEndFrameExclusive(range.endFrameExclusive);
  }

  function onPlotPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (navigationDisabled || axisViewport === null) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    beginRangeEdit();
    const generation = dragGenerationRef.current;
    const localX = event.clientX - rect.left;
    dragSessionRef.current = {
      generation,
      viewport: { ...axisViewport },
      widthPx: rect.width,
      startX: localX,
      currentX: localX,
    };
    setDragDraftRange(null);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onPlotPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const session = dragSessionRef.current;
    if (session === null || session.generation !== dragGenerationRef.current) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    session.currentX = event.clientX - rect.left;
    setDragDraftRange(framesFromDragPixels(
      session.viewport,
      session.widthPx,
      session.startX,
      session.currentX,
    ));
  }

  function endPlotPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const session = dragSessionRef.current;
    if (session === null || session.generation !== dragGenerationRef.current) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitDragSelection(session);
    dragSessionRef.current = null;
    setDragDraftRange(null);
  }

  function cancelPlotPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragSessionRef.current = null;
    setDragDraftRange(null);
  }

  const displayedWaveformError =
    waveformError !== null ? formatUserFacingError(new Error(waveformError), t) : null;
  const displayedRangeInvalid =
    rangeInvalid !== null ? formatUserFacingError(new Error(rangeInvalid), t) : null;
  const displayedPreviewError =
    previewError !== null ? formatUserFacingError(new Error(previewError), t) : null;
  const displayedRangeError =
    rangeError !== null ? formatUserFacingError(new Error(rangeError), t) : null;

  async function loadPreview() {
    const request = previewRequest.current + 1;
    previewRequest.current = request;
    stopSelectedRange();
    setPreviewing(true);
    setPreviewError(null);
    setPreviewUrl(null);
    setTruncated(false);
    try {
      const ticket = await api.createPreviewToken(rootId, assetId);
      const bytes = await api.readPreview(rootId, ticket.previewToken);
      if (previewRequest.current !== request) return;
      const buffer = toArrayBuffer(bytes);
      if (ticket.mimeType !== "audio/wav" || buffer.byteLength !== ticket.byteLength) {
        throw new Error("Preview response failed validation.");
      }
      const url = URL.createObjectURL(
        new Blob([buffer], { type: "audio/wav" }),
      );
      setPreviewUrl(url);
      setTruncated(ticket.truncated);
    } catch (error) {
      if (previewRequest.current === request) setPreviewError(errorMessage(error));
    } finally {
      if (previewRequest.current === request) setPreviewing(false);
    }
  }

  async function playSelectedRange() {
    if (fileMetadata === null) return;
    try {
      validateFrameRange(
        rangeStartFrame,
        rangeEndFrameExclusive,
        fileMetadata.frameCount,
        fileMetadata.sampleRate,
        fileMetadata.channels,
      );
    } catch (error) {
      setRangeInvalid(errorMessage(error));
      return;
    }
    const request = rangeRequest.current + 1;
    rangeRequest.current = request;
    stopRangePlayback();
    pauseHeadPreview();
    setRangeLoading(true);
    setRangeError(null);
    const range = {
      startFrame: rangeStartFrame,
      endFrameExclusive: rangeEndFrameExclusive,
    };
    const target = { rootId, assetId };
    try {
      const ticket = await api.createRangePreviewToken(rootId, assetId, range);
      if (!isCurrentRangeRequest(request, target)) {
        return;
      }
      const bytes = await api.readPreview(rootId, ticket.previewToken);
      if (!isCurrentRangeRequest(request, target)) {
        return;
      }
      const buffer = toArrayBuffer(bytes);
      if (
        ticket.mimeType !== "audio/wav"
        || buffer.byteLength !== ticket.byteLength
        || ticket.range.startFrame !== range.startFrame
        || ticket.range.endFrameExclusive !== range.endFrameExclusive
      ) {
        throw new Error("Range preview response failed validation.");
      }
      if (!isCurrentRangeRequest(request, target)) {
        return;
      }
      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      if (!isCurrentRangeRequest(request, target)) {
        URL.revokeObjectURL(url);
        return;
      }
      rangeObjectUrl.current = url;
      const element = rangeAudioRef.current;
      if (element === null) {
        URL.revokeObjectURL(url);
        rangeObjectUrl.current = null;
        return;
      }
      detachRangeListeners();
      const onEnded = () => {
        if (!isCurrentRangeRequest(request, target)) return;
        setRangePlaying(false);
        detachRangeListeners();
      };
      const onError = () => {
        if (!isCurrentRangeRequest(request, target)) return;
        setRangeError("Range preview playback failed.");
        setRangePlaying(false);
        detachRangeListeners();
      };
      rangeListenersRef.current = { element, onEnded, onError };
      element.addEventListener("ended", onEnded);
      element.addEventListener("error", onError);
      element.src = url;
      if (!isCurrentRangeRequest(request, target)) {
        URL.revokeObjectURL(url);
        rangeObjectUrl.current = null;
        detachRangeListeners();
        element.removeAttribute("src");
        element.load();
        return;
      }
      await element.play();
      if (isCurrentRangeRequest(request, target)) {
        setRangePlaying(true);
      }
    } catch (error) {
      if (isCurrentRangeRequest(request, target)) {
        setRangeError(errorMessage(error));
        stopRangePlayback();
      }
    } finally {
      if (rangeRequest.current === request) setRangeLoading(false);
    }
  }

  const rangeControlsDisabled = fileMetadata === null || rangeLoading;

  return (
    <section className="waveform-preview" role="region" aria-label={t("waveform.ariaFor", { displayName })}>
      <div className="waveform-preview-heading">
        <p>{t("waveform.heading")}</p>
        {durationLabel !== null && <span>{durationLabel}</span>}
      </div>

      <p className="waveform-preview-notice">{t("waveform.interactionHint")}</p>

      <div className="waveform-preview-actions waveform-preview-nav-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={navigationDisabled}
          aria-label={t("waveform.zoomIn")}
          onClick={() => {
            if (fileMetadata === null || viewportRange === null) return;
            setViewportRange(zoomViewport(viewportRange, fileMetadata.frameCount, true));
          }}
        >
          {t("waveform.zoomIn")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={navigationDisabled}
          aria-label={t("waveform.zoomOut")}
          onClick={() => {
            if (fileMetadata === null || viewportRange === null) return;
            setViewportRange(zoomViewport(viewportRange, fileMetadata.frameCount, false));
          }}
        >
          {t("waveform.zoomOut")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={navigationDisabled}
          aria-label={t("waveform.showAll")}
          onClick={() => {
            if (fileMetadata === null) return;
            setViewportRange(fullFileViewport(fileMetadata.frameCount));
          }}
        >
          {t("waveform.showAll")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={navigationDisabled}
          aria-label={t("waveform.panEarlier")}
          onClick={() => {
            if (fileMetadata === null || viewportRange === null) return;
            setViewportRange(panViewport(viewportRange, fileMetadata.frameCount, -1));
          }}
        >
          {t("waveform.panEarlier")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={navigationDisabled}
          aria-label={t("waveform.panLater")}
          onClick={() => {
            if (fileMetadata === null || viewportRange === null) return;
            setViewportRange(panViewport(viewportRange, fileMetadata.frameCount, 1));
          }}
        >
          {t("waveform.panLater")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={navigationDisabled || committedSelection === null}
          aria-label={t("waveform.fitSelection")}
          onClick={() => {
            if (fileMetadata === null || committedSelection === null) return;
            setViewportRange(viewportAroundRange(committedSelection, fileMetadata.frameCount));
          }}
        >
          {t("waveform.fitSelection")}
        </Button>
      </div>
      {axisViewport !== null && fileMetadata !== null && (
        <p className="waveform-preview-notice" role="status">
          {t("waveform.viewportFrames", {
            start: axisViewport.startFrame,
            end: axisViewport.endFrameExclusive,
          })}
        </p>
      )}

      {!peaksReady && waveformError === null && (
        <p className="waveform-preview-status" role="status">{t("waveform.generating")}</p>
      )}
      <div ref={plotContainerRef} className="waveform-preview-plot">
        {peaksReady && (
          <svg
            aria-label={t("waveform.plotAria")}
            className="waveform-preview-plot-svg"
            role="img"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            onPointerCancel={cancelPlotPointer}
            onPointerDown={onPlotPointerDown}
            onPointerMove={onPlotPointerMove}
            onPointerUp={endPlotPointer}
          >
            <line x1="0" x2={VIEWBOX_WIDTH} y1={VIEWBOX_HEIGHT / 2} y2={VIEWBOX_HEIGHT / 2} />
            {selectionHighlight !== null && (
              <rect
                className="waveform-preview-selection"
                height={VIEWBOX_HEIGHT}
                width={selectionHighlight.width}
                x={selectionHighlight.x}
                y="0"
              />
            )}
            {channelPaths.map((path, index) => (
              <path d={path} key={`channel-${index}`} />
            ))}
          </svg>
        )}
      </div>
      {displayedWaveformError !== null && (
        <p className="waveform-preview-error" role="alert">{displayedWaveformError}</p>
      )}

      <div className="waveform-preview-range" aria-label={t("waveform.rangeAria")}>
        <p className="waveform-preview-range-label">{t("waveform.rangeHeading")}</p>
        <div className="waveform-preview-range-fields">
          <label className="waveform-preview-range-field">
            <span>{t("waveform.startFrame")}</span>
            <input
              aria-label={t("waveform.startFrame")}
              aria-invalid={rangeInvalid !== null}
              disabled={rangeControlsDisabled}
              inputMode="numeric"
              onChange={(event) => {
                beginRangeEdit();
                setRangeStartFrame(event.target.value);
              }}
              value={rangeStartFrame}
            />
          </label>
          <label className="waveform-preview-range-field">
            <span>{t("waveform.endFrame")}</span>
            <input
              aria-label={t("waveform.endFrame")}
              aria-invalid={rangeInvalid !== null}
              disabled={rangeControlsDisabled}
              inputMode="numeric"
              onChange={(event) => {
                beginRangeEdit();
                setRangeEndFrameExclusive(event.target.value);
              }}
              value={rangeEndFrameExclusive}
            />
            <span className="waveform-preview-range-hint">{t("waveform.endFrameHint")}</span>
          </label>
        </div>
        {rangeDurationHint !== null && (
          <p className="waveform-preview-notice" role="status">
            {t("waveform.selectedSpan", { duration: rangeDurationHint })}
          </p>
        )}
        {displayedRangeInvalid !== null && (
          <p className="waveform-preview-error" role="alert">{displayedRangeInvalid}</p>
        )}
        <div className="waveform-preview-actions waveform-preview-range-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={rangeControlsDisabled || rangeInvalid !== null || rangePlaying}
            onClick={() => void playSelectedRange()}
          >
            {rangeLoading ? t("waveform.preparingRange") : t("waveform.playRange")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!rangePlaying && !rangeLoading}
            onClick={stopSelectedRange}
          >
            {t("waveform.stop")}
          </Button>
        </div>
        {displayedRangeError !== null && (
          <p className="waveform-preview-error" role="alert">{displayedRangeError}</p>
        )}
        <audio
          ref={rangeAudioRef}
          aria-label={t("waveform.rangePreviewAria", { displayName })}
          className="waveform-preview-range-audio"
          preload="none"
        />
      </div>

      <div className="waveform-preview-actions">
        <Button type="button" variant="secondary" disabled={previewing} onClick={loadPreview}>
          {previewing ? t("waveform.preparingPreview") : t("waveform.loadPreview")}
        </Button>
      </div>
      {previewUrl !== null && (
        <audio
          ref={headAudioRef}
          aria-label={t("waveform.previewAria", { displayName })}
          controls
          onPlay={stopSelectedRange}
          preload="metadata"
          src={previewUrl}
        />
      )}
      {truncated && (
        <p className="waveform-preview-notice">{t("waveform.truncatedNotice")}</p>
      )}
      {displayedPreviewError !== null && (
        <p className="waveform-preview-error" role="alert">{displayedPreviewError}</p>
      )}
      <p className="waveform-preview-boundary">{t("waveform.boundary")}</p>
    </section>
  );
}
