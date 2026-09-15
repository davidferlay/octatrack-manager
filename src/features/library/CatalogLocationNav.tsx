import { useTranslate } from "../../i18n";
import {
  displayCatalogLocationLabel,
  displayCatalogSourceLabel,
  type CatalogLocationOption,
  type CatalogSourceOption,
} from "./catalogBrowseModel";
import "./CatalogLocationNav.css";

export type CatalogLocationNavVariant = "columns" | "tree";

export interface CatalogLocationNavProps {
  variant?: CatalogLocationNavVariant;
  sources: CatalogSourceOption[];
  selectedSourceKey: string | undefined;
  locations: CatalogLocationOption[];
  selectedLocationKey: string | undefined;
  onSelectSource: (key: string) => void;
  onSelectLocation: (key: string) => void;
  loading?: boolean;
  error?: string | null;
}

export function CatalogLocationNav({
  variant = "tree",
  sources,
  selectedSourceKey,
  locations,
  selectedLocationKey,
  onSelectSource,
  onSelectLocation,
  loading = false,
  error = null,
}: CatalogLocationNavProps) {
  const t = useTranslate();

  if (loading) {
    return <p className="catalog-location-nav__state">{t("workspace.navLoading")}</p>;
  }
  if (error !== null) {
    return (
      <p className="catalog-location-nav__state catalog-location-nav__state--error" role="alert">
        {error}
      </p>
    );
  }
  if (sources.length === 0) {
    return <p className="catalog-location-nav__state">{t("library.noCatalogEntries")}</p>;
  }

  if (variant === "columns") {
    return (
      <div className="catalog-location-nav catalog-location-nav--columns">
        <div className="catalog-library-column" aria-label={t("library.sourcesAria")}>
          <h4>{t("library.browseColumn")}</h4>
          <div className="catalog-library-options">
            {sources.map((source) => (
              <button
                type="button"
                className="catalog-library-option"
                aria-pressed={source.key === selectedSourceKey}
                key={source.key}
                onClick={() => onSelectSource(source.key)}
              >
                <span>{displayCatalogSourceLabel(source, t)}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
        <div className="catalog-library-column" aria-label={t("library.locationsAria")}>
          <h4>{t("library.locationsColumn")}</h4>
          <div className="catalog-library-options">
            {locations.map((location) => (
              <button
                type="button"
                className="catalog-library-option"
                aria-pressed={location.key === selectedLocationKey}
                key={location.key}
                onClick={() => onSelectLocation(location.key)}
              >
                <span>{displayCatalogLocationLabel(location, t)}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
            {locations.length === 0 && (
              <p className="catalog-library-empty">{t("library.noLocations")}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const activeSourceKey = selectedSourceKey ?? sources[0]?.key;

  return (
    <nav className="catalog-location-nav catalog-location-nav--tree" aria-label={t("workspace.navAria")}>
      <h2 className="catalog-location-nav__heading">{t("workspace.navHeading")}</h2>
      <ul className="catalog-location-nav__tree">
        {sources.map((source) => {
          const isSourceSelected = source.key === activeSourceKey;
          return (
            <li key={source.key} className="catalog-location-nav__source">
              <button
                type="button"
                className="catalog-location-nav__source-btn"
                aria-expanded={isSourceSelected}
                aria-pressed={isSourceSelected}
                onClick={() => onSelectSource(source.key)}
              >
                {displayCatalogSourceLabel(source, t)}
              </button>
              {isSourceSelected && (
                <ul className="catalog-location-nav__locations">
                  {locations.map((location) => (
                    <li key={location.key}>
                      <button
                        type="button"
                        className="catalog-location-nav__location-btn"
                        aria-pressed={location.key === selectedLocationKey}
                        onClick={() => onSelectLocation(location.key)}
                      >
                        {displayCatalogLocationLabel(location, t)}
                      </button>
                    </li>
                  ))}
                  {locations.length === 0 && (
                    <li className="catalog-location-nav__empty">{t("library.noLocations")}</li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
