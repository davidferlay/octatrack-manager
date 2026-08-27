CREATE TABLE audio_assets (
    id INTEGER PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE CHECK (
        length(content_hash) = 71
        AND substr(content_hash, 1, 7) = 'sha256:'
        AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0)
);

CREATE TABLE file_instances (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    scan_session_id INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    audio_asset_id INTEGER NOT NULL REFERENCES audio_assets(id),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    modified_at_unix_ns INTEGER,
    storage_scope TEXT NOT NULL CHECK (
        storage_scope IN (
            'set_audio_pool',
            'project_local',
            'unclassified'
        )
    ),
    hash_freshness TEXT NOT NULL CHECK (
        hash_freshness IN (
            'computed_this_scan',
            'reused_unchanged_metadata'
        )
    ),
    UNIQUE (root_id, relative_path),
    FOREIGN KEY (scan_session_id, root_id)
        REFERENCES scan_sessions(id, root_id)
);

CREATE INDEX file_instances_root_scope_path
    ON file_instances(root_id, storage_scope, relative_path);

CREATE INDEX file_instances_audio_asset
    ON file_instances(audio_asset_id);
