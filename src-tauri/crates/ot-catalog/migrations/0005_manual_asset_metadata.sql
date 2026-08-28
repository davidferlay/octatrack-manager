CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE BINARY UNIQUE CHECK (
        length(name) BETWEEN 1 AND 64
        AND name = trim(name)
    ),
    created_at TEXT NOT NULL
);

CREATE TABLE tag_assignments (
    audio_asset_id INTEGER NOT NULL
        REFERENCES audio_assets(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    -- Analyzer and AI sources require provenance fields and a later migration.
    source TEXT NOT NULL CHECK (source = 'user'),
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (audio_asset_id, tag_id, source)
);

CREATE INDEX tag_assignments_asset_source
    ON tag_assignments(audio_asset_id, source);

CREATE TABLE notes (
    audio_asset_id INTEGER NOT NULL REFERENCES audio_assets(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4096),
    -- Analyzer and AI sources require provenance fields and a later migration.
    source TEXT NOT NULL CHECK (source = 'user'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (audio_asset_id, source)
);
