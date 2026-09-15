import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MetadataApi } from "../../api";
import { tJa } from "../../i18n/testStrings";
import { ManualAssetMetadataEditor } from "./ManualAssetMetadataEditor";

function fakeApi(): MetadataApi {
  return {
    loadManualAssetMetadata: vi.fn().mockResolvedValue({
      tags: ["808", "kick"],
      note: "Main live kick",
    }),
    replaceManualAssetMetadata: vi.fn().mockImplementation(
      async (_rootId, _assetId, metadata) => ({
        ...metadata,
        tags: [...metadata.tags].sort(),
      }),
    ),
  };
}

describe("ManualAssetMetadataEditor", () => {
  it("loads and replaces metadata using only opaque IDs", async () => {
    const api = fakeApi();
    render(
      <ManualAssetMetadataEditor
        api={api}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="KICK.wav"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(tJa("metadata.tagsAria"))).toHaveValue("808\nkick");
    });
    expect(api.loadManualAssetMetadata).toHaveBeenCalledWith(
      "root-opaque",
      "asset:v1:opaque",
    );

    fireEvent.change(screen.getByLabelText(tJa("metadata.tagsAria")), {
      target: { value: "warm\nkick" },
    });
    fireEvent.change(screen.getByLabelText(tJa("metadata.noteAria")), {
      target: { value: "Layer for the live set" },
    });
    fireEvent.click(screen.getByRole("button", { name: tJa("metadata.save") }));

    await waitFor(() => {
      expect(api.replaceManualAssetMetadata).toHaveBeenCalledWith(
        "root-opaque",
        "asset:v1:opaque",
        {
          tags: ["warm", "kick"],
          note: "Layer for the live set",
        },
      );
    });
    expect(await screen.findByText(tJa("metadata.saved"))).toBeInTheDocument();
    expect(screen.getByLabelText(tJa("metadata.tagsAria"))).toHaveValue("kick\nwarm");
  });

  it("reports load failures and keeps the editor disabled", async () => {
    const api = fakeApi();
    vi.mocked(api.loadManualAssetMetadata).mockRejectedValue(
      new Error("Asset is no longer in this root snapshot"),
    );

    render(
      <ManualAssetMetadataEditor
        api={api}
        rootId="root-opaque"
        assetId="asset:v1:missing"
        displayName="MISSING.wav"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Asset is no longer in this root snapshot",
    );
    expect(screen.getByRole("button", { name: tJa("metadata.save") })).toBeDisabled();
  });

  it("does not show metadata from a previously selected Asset after a load failure", async () => {
    const api = fakeApi();
    const { rerender } = render(
      <ManualAssetMetadataEditor
        api={api}
        rootId="root-opaque"
        assetId="asset:v1:first"
        displayName="FIRST.wav"
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText(tJa("metadata.tagsAria"))).toHaveValue("808\nkick");
    });
    vi.mocked(api.loadManualAssetMetadata).mockRejectedValueOnce(
      new Error("Asset is no longer in this root snapshot"),
    );

    rerender(
      <ManualAssetMetadataEditor
        api={api}
        rootId="root-opaque"
        assetId="asset:v1:missing"
        displayName="MISSING.wav"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Asset is no longer in this root snapshot",
    );
    expect(screen.getByLabelText(tJa("metadata.tagsAria"))).toHaveValue("");
    expect(screen.getByLabelText(tJa("metadata.noteAria"))).toHaveValue("");
  });

  it("uses null to clear an empty note", async () => {
    const api = fakeApi();
    render(
      <ManualAssetMetadataEditor
        api={api}
        rootId="root-opaque"
        assetId="asset:v1:opaque"
        displayName="KICK.wav"
      />,
    );
    await screen.findByDisplayValue("Main live kick");

    fireEvent.change(screen.getByLabelText(tJa("metadata.noteAria")), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: tJa("metadata.save") }));

    await waitFor(() => {
      expect(api.replaceManualAssetMetadata).toHaveBeenCalledWith(
        "root-opaque",
        "asset:v1:opaque",
        expect.objectContaining({ note: null }),
      );
    });
  });
});
