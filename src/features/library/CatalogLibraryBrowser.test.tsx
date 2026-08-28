import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LibrarySnapshot } from "../../api";
import { CatalogLibraryBrowser } from "./CatalogLibraryBrowser";

const snapshot: LibrarySnapshot = {
  sets: [{
    displayName: "LIVE_SET",
    relativePath: "LIVE_SET",
    hasAudioPool: true,
    projects: [{
      displayName: "PROJECT_A",
      relativePath: "LIVE_SET/PROJECT_A",
      hasProjectFile: true,
      hasBanks: true,
    }],
  }],
  standaloneProjects: [{
    displayName: "STANDALONE",
    relativePath: "STANDALONE",
    hasProjectFile: true,
    hasBanks: false,
  }],
  audioFiles: [
    {
      fileInstanceId: "fileinst:v1:pool",
      assetId: "asset:v1:pool",
      displayName: "POOL.wav",
      relativePath: "LIVE_SET/AUDIO/POOL.wav",
      byteSize: 2048,
      storageScope: "set_audio_pool",
    },
    {
      fileInstanceId: "fileinst:v1:project",
      assetId: "asset:v1:project",
      displayName: "PROJECT.wav",
      relativePath: "LIVE_SET/PROJECT_A/PROJECT.wav",
      byteSize: 4096,
      storageScope: "project_local",
    },
    {
      fileInstanceId: "fileinst:v1:standalone",
      assetId: "asset:v1:standalone",
      displayName: "STANDALONE.wav",
      relativePath: "STANDALONE/STANDALONE.wav",
      byteSize: 512,
      storageScope: "project_local",
    },
  ],
};

describe("CatalogLibraryBrowser", () => {
  it("browses Set Audio Pool and Project-local files without absolute paths", () => {
    render(<CatalogLibraryBrowser snapshot={snapshot} />);

    const files = screen.getByLabelText("Audio files");
    expect(within(files).getByText("POOL.wav")).toBeInTheDocument();
    expect(within(files).queryByText("PROJECT.wav")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PROJECT_A/ }));
    expect(within(files).getByText("PROJECT.wav")).toBeInTheDocument();
    expect(within(files).queryByText("POOL.wav")).not.toBeInTheDocument();
    expect(files).not.toHaveTextContent("/private/");
  });

  it("keeps standalone Projects in a separate source", () => {
    render(<CatalogLibraryBrowser snapshot={snapshot} />);

    fireEvent.click(
      within(screen.getByLabelText("Sources")).getByRole("button", { name: /Standalone/ }),
    );

    expect(
      within(screen.getByLabelText("Locations")).getByRole("button", { name: /STANDALONE/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Audio files")).toHaveTextContent("STANDALONE.wav");
  });

  it("orders root-relative paths deterministically without locale collation", () => {
    const { container } = render(
      <CatalogLibraryBrowser
        snapshot={{
          ...snapshot,
          audioFiles: [
            {
              ...snapshot.audioFiles[0],
              fileInstanceId: "fileinst:v1:lower",
              displayName: "a.wav",
              relativePath: "LIVE_SET/AUDIO/a.wav",
            },
            {
              ...snapshot.audioFiles[0],
              fileInstanceId: "fileinst:v1:upper",
              displayName: "Z.wav",
              relativePath: "LIVE_SET/AUDIO/Z.wav",
            },
          ],
        }}
      />,
    );

    expect(
      Array.from(container.querySelectorAll(".catalog-library-file strong"))
        .map((element) => element.textContent),
    ).toEqual(["Z.wav", "a.wav"]);
  });

  it("reports an empty catalog explicitly", () => {
    render(
      <CatalogLibraryBrowser
        snapshot={{ sets: [], standaloneProjects: [], audioFiles: [] }}
      />,
    );

    expect(screen.getByText("No catalog entries are available.")).toBeInTheDocument();
  });
});
