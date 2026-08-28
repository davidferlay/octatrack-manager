import { useEffect, useState, type FormEvent } from "react";
import {
  metadataApi,
  type ManualAssetMetadata,
  type MetadataApi,
} from "../../api";
import { Button } from "../../design-system";
import "./ManualAssetMetadataEditor.css";

interface ManualAssetMetadataEditorProps {
  rootId: string;
  assetId: string;
  displayName: string;
  api?: MetadataApi;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function tagsFromText(value: string): string[] {
  return value
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function applyMetadata(
  metadata: ManualAssetMetadata,
  setTagsText: (value: string) => void,
  setNote: (value: string) => void,
) {
  setTagsText(metadata.tags.join("\n"));
  setNote(metadata.note ?? "");
}

export function ManualAssetMetadataEditor({
  rootId,
  assetId,
  displayName,
  api = metadataApi,
}: ManualAssetMetadataEditorProps) {
  const [tagsText, setTagsText] = useState("");
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoading(true);
    setSaved(false);
    setError(null);
    setTagsText("");
    setNote("");
    api.loadManualAssetMetadata(rootId, assetId).then(
      (metadata) => {
        if (!active) return;
        applyMetadata(metadata, setTagsText, setNote);
        setReady(true);
        setLoading(false);
      },
      (reason) => {
        if (!active) return;
        setError(errorMessage(reason));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [api, assetId, rootId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const metadata = await api.replaceManualAssetMetadata(rootId, assetId, {
        tags: tagsFromText(tagsText),
        note: note.trim().length === 0 ? null : note,
      });
      applyMetadata(metadata, setTagsText, setNote);
      setSaved(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="manual-asset-metadata" onSubmit={save}>
      <div className="manual-asset-metadata-heading">
        <p>Asset metadata</p>
        <h4>{displayName}</h4>
      </div>

      {loading ? (
        <p className="manual-asset-metadata-status" role="status">
          Loading metadata...
        </p>
      ) : (
        <>
          <label>
            <span>Tags (one per line)</span>
            <textarea
              aria-label="Tags (one per line)"
              disabled={!ready || saving}
              rows={4}
              value={tagsText}
              onChange={(event) => {
                setTagsText(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label>
            <span>Note</span>
            <textarea
              aria-label="Note"
              disabled={!ready || saving}
              maxLength={4096}
              rows={7}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="manual-asset-metadata-actions">
            <Button variant="secondary" disabled={!ready || saving} type="submit">
              {saving ? "Saving..." : "Save metadata"}
            </Button>
            {saved && (
              <span className="manual-asset-metadata-saved" role="status">
                Saved
              </span>
            )}
          </div>
        </>
      )}

      {error !== null && (
        <p className="manual-asset-metadata-error" role="alert">
          {error}
        </p>
      )}
      <p className="manual-asset-metadata-boundary">
        Stored in the local catalog. The source media remains unchanged.
      </p>
    </form>
  );
}
