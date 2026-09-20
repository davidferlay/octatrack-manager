DROP TRIGGER IF EXISTS sample_settings_owner_scope_insert;
DROP TRIGGER IF EXISTS sample_settings_owner_scope_update;

CREATE TABLE file_instances_new (
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
            'unclassified',
            'mac_derived'
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

INSERT INTO file_instances_new (
    id,
    root_id,
    scan_session_id,
    relative_path,
    audio_asset_id,
    byte_size,
    modified_at_unix_ns,
    storage_scope,
    hash_freshness
)
SELECT
    id,
    root_id,
    scan_session_id,
    relative_path,
    audio_asset_id,
    byte_size,
    modified_at_unix_ns,
    storage_scope,
    hash_freshness
FROM file_instances;

DROP TABLE file_instances;
ALTER TABLE file_instances_new RENAME TO file_instances;

CREATE INDEX file_instances_root_scope_path
    ON file_instances(root_id, storage_scope, relative_path);

CREATE INDEX file_instances_audio_asset
    ON file_instances(audio_asset_id);

CREATE TRIGGER sample_settings_owner_scope_insert
BEFORE INSERT ON sample_settings
WHEN (
    NEW.owner_kind = 'slot_assignment'
    AND NOT EXISTS (
        SELECT 1
        FROM slot_assignments
        JOIN state_documents
          ON state_documents.id = slot_assignments.state_document_id
        WHERE slot_assignments.id = NEW.slot_assignment_id
          AND state_documents.root_id = NEW.root_id
          AND state_documents.scan_session_id = NEW.scan_session_id
    )
) OR (
    NEW.owner_kind = 'file_instance_sidecar'
    AND NOT EXISTS (
        SELECT 1
        FROM file_instances
        WHERE file_instances.id = NEW.file_instance_id
          AND file_instances.root_id = NEW.root_id
          AND file_instances.scan_session_id = NEW.scan_session_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'sample settings owner scope mismatch');
END;

CREATE TRIGGER sample_settings_owner_scope_update
BEFORE UPDATE OF root_id, scan_session_id, owner_kind, slot_assignment_id, file_instance_id
ON sample_settings
WHEN (
    NEW.owner_kind = 'slot_assignment'
    AND NOT EXISTS (
        SELECT 1
        FROM slot_assignments
        JOIN state_documents
          ON state_documents.id = slot_assignments.state_document_id
        WHERE slot_assignments.id = NEW.slot_assignment_id
          AND state_documents.root_id = NEW.root_id
          AND state_documents.scan_session_id = NEW.scan_session_id
    )
) OR (
    NEW.owner_kind = 'file_instance_sidecar'
    AND NOT EXISTS (
        SELECT 1
        FROM file_instances
        WHERE file_instances.id = NEW.file_instance_id
          AND file_instances.root_id = NEW.root_id
          AND file_instances.scan_session_id = NEW.scan_session_id
    )
)
BEGIN
    SELECT RAISE(ABORT, 'sample settings owner scope mismatch');
END;
