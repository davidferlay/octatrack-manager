import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  audioApi,
  type AudioApi,
  type AudioPreviewBytes,
  type AudioWaveformWindow,
  type WaveformPeak,
} from "../../api";
import { Button } from "../../design-system";
import {
  durationLabelForFrame,
  durationSeconds,
  validateFrameRange,
} from "./frameMath";
import "./WaveformPreview.css";

const TARGET_POINTS = 640;
const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 140;

interface WaveformPreviewProps {
  rootId: string;
  assetId: string;
  displayName: string;
  api?: AudioApi;
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function WaveformPreview({
  rootId,
  assetId,
  displayName,
  api = audioApi,
}: WaveformPreviewProps) {
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
  const rangeAudioRef = useRef<HTMLAudioElement | null>(null);
  const rangeObjectUrl = useRef<string | null>(null);
  const selectionRef = useRef({ rootId, assetId });
  selectionRef.current = { rootId, assetId };

  const stopRangePlayback = useCallback(() => {
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
  }, []);

  useEffect(() => {
    const request = waveformRequest.current + 1;
    waveformRequest.current = request;
    setWaveform(null);
    setWaveformError(null);
    api
      .queryWaveform(rootId, assetId, { range: null, targetPoints: TARGET_POINTS })
      .then(
        (nextWaveform) => {
          if (waveformRequest.current === request) {
            setWaveform(nextWaveform);
            setRangeStartFrame("0");
            setRangeEndFrameExclusive(nextWaveform.frameCount);
            setRangeInvalid(null);
          }
        },
        (error) => {
          if (waveformRequest.current === request) setWaveformError(errorMessage(error));
        },
      );
    return () => {
      waveformRequest.current += 1;
    };
  }, [api, assetId, rootId]);

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
    stopRangePlayback();
  }, [assetId, rootId, stopRangePlayback]);

  useEffect(() => {
    if (waveform === null) return;
    try {
      validateFrameRange(rangeStartFrame, rangeEndFrameExclusive, waveform.frameCount);
      setRangeInvalid(null);
    } catch (error) {
      setRangeInvalid(errorMessage(error));
    }
  }, [rangeEndFrameExclusive, rangeStartFrame, waveform]);

  const channelPaths = useMemo(() => {
    if (waveform === null) return [];
    return waveform.channelPeaks.map((channel) =>
      waveformChannelPath(channel, channel.length),
    );
  }, [waveform]);

  const durationLabel = useMemo(() => {
    if (waveform === null) return null;
    return formatDuration(durationSeconds(waveform.frameCount, waveform.sampleRate));
  }, [waveform]);

  const rangeDurationHint = useMemo(() => {
    if (waveform === null || rangeInvalid !== null) return null;
    try {
      validateFrameRange(rangeStartFrame, rangeEndFrameExclusive, waveform.frameCount);
    } catch {
      return null;
    }
    const span = (
      BigInt(rangeEndFrameExclusive) - BigInt(rangeStartFrame)
    ).toString();
    return durationLabelForFrame(span, waveform.sampleRate);
  }, [rangeEndFrameExclusive, rangeInvalid, rangeStartFrame, waveform]);

  async function loadPreview() {
    const request = previewRequest.current + 1;
    previewRequest.current = request;
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
    if (waveform === null) return;
    try {
      validateFrameRange(rangeStartFrame, rangeEndFrameExclusive, waveform.frameCount);
    } catch (error) {
      setRangeInvalid(errorMessage(error));
      return;
    }
    const request = rangeRequest.current + 1;
    rangeRequest.current = request;
    stopRangePlayback();
    setRangeLoading(true);
    setRangeError(null);
    const range = {
      startFrame: rangeStartFrame,
      endFrameExclusive: rangeEndFrameExclusive,
    };
    const target = { rootId, assetId };
    try {
      const ticket = await api.createRangePreviewToken(rootId, assetId, range);
      if (
        rangeRequest.current !== request
        || selectionRef.current.rootId !== target.rootId
        || selectionRef.current.assetId !== target.assetId
      ) {
        return;
      }
      const bytes = await api.readPreview(rootId, ticket.previewToken);
      if (
        rangeRequest.current !== request
        || selectionRef.current.rootId !== target.rootId
        || selectionRef.current.assetId !== target.assetId
      ) {
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
      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
      rangeObjectUrl.current = url;
      const element = rangeAudioRef.current;
      if (element === null) {
        URL.revokeObjectURL(url);
        rangeObjectUrl.current = null;
        return;
      }
      const onEnded = () => {
        setRangePlaying(false);
        element.removeEventListener("ended", onEnded);
        element.removeEventListener("error", onError);
      };
      const onError = () => {
        if (rangeRequest.current === request) {
          setRangeError("Range preview playback failed.");
          setRangePlaying(false);
        }
        element.removeEventListener("ended", onEnded);
        element.removeEventListener("error", onError);
      };
      element.addEventListener("ended", onEnded);
      element.addEventListener("error", onError);
      element.src = url;
      await element.play();
      if (rangeRequest.current === request) setRangePlaying(true);
    } catch (error) {
      if (rangeRequest.current === request) setRangeError(errorMessage(error));
      stopRangePlayback();
    } finally {
      if (rangeRequest.current === request) setRangeLoading(false);
    }
  }

  function stopSelectedRange() {
    rangeRequest.current += 1;
    stopRangePlayback();
    setRangeLoading(false);
    setRangeError(null);
  }

  const rangeControlsDisabled = waveform === null || rangeLoading;

  return (
    <section className="waveform-preview" aria-label={`Waveform preview for ${displayName}`}>
      <div className="waveform-preview-heading">
        <p>Waveform</p>
        {durationLabel !== null && <span>{durationLabel}</span>}
      </div>

      {waveform === null && waveformError === null && (
        <p className="waveform-preview-status" role="status">Generating waveform...</p>
      )}
      {waveform !== null && (
        <svg
          aria-label="Audio waveform"
          className="waveform-preview-plot"
          role="img"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        >
          <line x1="0" x2={VIEWBOX_WIDTH} y1={VIEWBOX_HEIGHT / 2} y2={VIEWBOX_HEIGHT / 2} />
          {channelPaths.map((path, index) => (
            <path d={path} key={`channel-${index}`} />
          ))}
        </svg>
      )}
      {waveformError !== null && (
        <p className="waveform-preview-error" role="alert">{waveformError}</p>
      )}

      <div className="waveform-preview-range" aria-label="Preview range">
        <p className="waveform-preview-range-label">Range preview</p>
        <div className="waveform-preview-range-fields">
          <label className="waveform-preview-range-field">
            <span>Start frame</span>
            <input
              aria-invalid={rangeInvalid !== null}
              disabled={rangeControlsDisabled}
              inputMode="numeric"
              onChange={(event) => setRangeStartFrame(event.target.value)}
              value={rangeStartFrame}
            />
          </label>
          <label className="waveform-preview-range-field">
            <span>End frame (exclusive)</span>
            <input
              aria-invalid={rangeInvalid !== null}
              disabled={rangeControlsDisabled}
              inputMode="numeric"
              onChange={(event) => setRangeEndFrameExclusive(event.target.value)}
              value={rangeEndFrameExclusive}
            />
          </label>
        </div>
        {rangeDurationHint !== null && (
          <p className="waveform-preview-notice" role="status">
            Selected span: {rangeDurationHint}
          </p>
        )}
        {rangeInvalid !== null && (
          <p className="waveform-preview-error" role="alert">{rangeInvalid}</p>
        )}
        <div className="waveform-preview-actions waveform-preview-range-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={rangeControlsDisabled || rangeInvalid !== null || rangePlaying}
            onClick={() => void playSelectedRange()}
          >
            {rangeLoading ? "Preparing range..." : "Play selected range"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!rangePlaying && !rangeLoading}
            onClick={stopSelectedRange}
          >
            Stop
          </Button>
        </div>
        {rangeError !== null && (
          <p className="waveform-preview-error" role="alert">{rangeError}</p>
        )}
        <audio
          ref={rangeAudioRef}
          aria-label={`Range preview ${displayName}`}
          className="waveform-preview-range-audio"
          preload="none"
        />
      </div>

      <div className="waveform-preview-actions">
        <Button type="button" variant="secondary" disabled={previewing} onClick={loadPreview}>
          {previewing ? "Preparing preview..." : "Load preview"}
        </Button>
      </div>
      {previewUrl !== null && (
        <audio aria-label={`Preview ${displayName}`} controls preload="metadata" src={previewUrl} />
      )}
      {truncated && (
        <p className="waveform-preview-notice">Preview is limited to the first 60 seconds.</p>
      )}
      {previewError !== null && (
        <p className="waveform-preview-error" role="alert">{previewError}</p>
      )}
      <p className="waveform-preview-boundary">
        Peaks are cached locally. Preview access uses a one-shot, short-lived token.
      </p>
    </section>
  );
}
