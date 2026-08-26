CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    applied_at TEXT NOT NULL
);

CREATE TABLE roots (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    identity_is_stable INTEGER NOT NULL CHECK (identity_is_stable IN (0, 1)),
    display_name TEXT NOT NULL,
    last_observed_revision INTEGER NOT NULL CHECK (last_observed_revision >= 0),
    last_observed_at TEXT NOT NULL,
    latest_completed_scan_revision INTEGER CHECK (latest_completed_scan_revision > 0)
);

CREATE TABLE scan_sessions (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    failure_code TEXT CHECK (failure_code IN ('SNAPSHOT_VALIDATION', 'PERSISTENCE')),
    UNIQUE (root_id, revision),
    UNIQUE (id, root_id),
    CHECK (
        (status = 'running' AND completed_at IS NULL AND failure_code IS NULL)
        OR (status = 'completed' AND completed_at IS NOT NULL AND failure_code IS NULL)
        OR (status = 'failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
    )
);

CREATE TABLE sets (
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    scan_session_id INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    has_audio_pool INTEGER NOT NULL CHECK (has_audio_pool IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (root_id, relative_path),
    FOREIGN KEY (scan_session_id, root_id) REFERENCES scan_sessions(id, root_id)
);

CREATE TABLE projects (
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    scan_session_id INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_standalone INTEGER NOT NULL CHECK (is_standalone IN (0, 1)),
    parent_set_relative_path TEXT,
    has_project_file INTEGER NOT NULL CHECK (has_project_file IN (0, 1)),
    has_banks INTEGER NOT NULL CHECK (has_banks IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (root_id, relative_path),
    CHECK (
        (is_standalone = 1 AND parent_set_relative_path IS NULL)
        OR (is_standalone = 0 AND parent_set_relative_path IS NOT NULL)
    ),
    FOREIGN KEY (scan_session_id, root_id) REFERENCES scan_sessions(id, root_id),
    FOREIGN KEY (root_id, parent_set_relative_path) REFERENCES sets(root_id, relative_path)
);

CREATE INDEX scan_sessions_root_revision
    ON scan_sessions(root_id, revision DESC);
CREATE INDEX projects_parent_set
    ON projects(root_id, parent_set_relative_path, relative_path);
