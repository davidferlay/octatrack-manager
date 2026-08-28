import { useEffect, useMemo, useRef, useState } from "react";
import {
  audioApi,
  type AudioApi,
  type AudioPreviewBytes,
  type AudioWaveform,
} from "../../api";
import { Button } from "../../design-system";
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

export function waveformPath(waveform: AudioWaveform): string {
  if (waveform.peaks.length === 0) return "";
  const xScale = VIEWBOX_WIDTH / waveform.peaks.length;
  const center = VIEWBOX_HEIGHT / 2;
  return waveform.peaks
    .map((peak, index) => {
      const x = (index + 0.5) * xScale;
      const top = center - Math.max(-1, Math.min(1, peak.max)) * center;
      const bottom = center - Math.max(-1, Math.min(1, peak.min)) * center;
      return `M${x.toFixed(2)} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
    })
    .join("");
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
  const [waveform, setWaveform] = useState<AudioWaveform | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const previewRequest = useRef(0);

  useEffect(() => {
    let active = true;
    setWaveform(null);
    setWaveformError(null);
    api.getWaveform(rootId, assetId, TARGET_POINTS).then(
      (nextWaveform) => {
        if (active) setWaveform(nextWaveform);
      },
      (error) => {
        if (active) setWaveformError(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [api, assetId, rootId]);

  useEffect(() => () => {
    if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    previewRequest.current += 1;
    setPreviewUrl(null);
    setPreviewError(null);
    setTruncated(false);
  }, [assetId, rootId]);

  const path = useMemo(() => waveform === null ? "" : waveformPath(waveform), [waveform]);

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

  return (
    <section className="waveform-preview" aria-label={`Waveform preview for ${displayName}`}>
      <div className="waveform-preview-heading">
        <p>Waveform</p>
        {waveform !== null && <span>{formatDuration(waveform.durationSeconds)}</span>}
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
          <path d={path} />
        </svg>
      )}
      {waveformError !== null && (
        <p className="waveform-preview-error" role="alert">{waveformError}</p>
      )}

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
