CREATE TABLE sample_settings (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    scan_session_id INTEGER NOT NULL,
    owner_kind TEXT NOT NULL CHECK (
        owner_kind IN ('slot_assignment', 'file_instance_sidecar')
    ),
    source_relative_path TEXT NOT NULL,
    marker_source_relative_path TEXT,
    slot_assignment_id INTEGER REFERENCES slot_assignments(id) ON DELETE CASCADE,
    file_instance_id INTEGER REFERENCES file_instances(id) ON DELETE CASCADE,
    parse_status TEXT NOT NULL CHECK (
        parse_status IN ('parsed', 'unsupported_version', 'malformed')
    ),
    parser_name TEXT NOT NULL CHECK (length(parser_name) > 0),
    parser_revision TEXT NOT NULL CHECK (length(parser_revision) > 0),
    source_version TEXT,
    source_os_version TEXT,
    evidence TEXT NOT NULL CHECK (
        evidence IN (
            'official_documentation',
            'reproduced_fixture_observation',
            'legacy_implementation_observation'
        )
    ),
    gain INTEGER CHECK (gain BETWEEN 0 AND 65535),
    tempo_x24 INTEGER CHECK (tempo_x24 BETWEEN 0 AND 4294967295),
    trim_bars_x100 INTEGER CHECK (trim_bars_x100 BETWEEN 0 AND 4294967295),
    loop_bars_x100 INTEGER CHECK (loop_bars_x100 BETWEEN 0 AND 4294967295),
    stretch_mode INTEGER CHECK (stretch_mode BETWEEN 0 AND 4294967295),
    loop_mode INTEGER CHECK (loop_mode BETWEEN 0 AND 4294967295),
    trig_quantization INTEGER CHECK (
        trig_quantization BETWEEN -2147483648 AND 2147483647
    ),
    trim_start INTEGER CHECK (trim_start BETWEEN 0 AND 4294967295),
    trim_end INTEGER CHECK (trim_end BETWEEN 0 AND 4294967295),
    loop_start INTEGER CHECK (loop_start BETWEEN 0 AND 4294967295),
    UNIQUE (root_id, owner_kind, source_relative_path, slot_assignment_id, file_instance_id),
    FOREIGN KEY (scan_session_id, root_id)
        REFERENCES scan_sessions(id, root_id),
    CHECK (
        (owner_kind = 'slot_assignment'
            AND slot_assignment_id IS NOT NULL
            AND file_instance_id IS NULL)
        OR (owner_kind = 'file_instance_sidecar'
            AND slot_assignment_id IS NULL
            AND file_instance_id IS NOT NULL
            AND marker_source_relative_path IS NULL)
    )
);

CREATE UNIQUE INDEX sample_settings_slot_owner
    ON sample_settings(slot_assignment_id)
    WHERE owner_kind = 'slot_assignment';

CREATE UNIQUE INDEX sample_settings_file_owner
    ON sample_settings(file_instance_id)
    WHERE owner_kind = 'file_instance_sidecar';

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

CREATE TABLE sample_slices (
    sample_settings_id INTEGER NOT NULL
        REFERENCES sample_settings(id) ON DELETE CASCADE,
    slice_index INTEGER NOT NULL CHECK (slice_index BETWEEN 0 AND 63),
    trim_start INTEGER NOT NULL CHECK (trim_start BETWEEN 0 AND 4294967295),
    trim_end INTEGER NOT NULL CHECK (trim_end BETWEEN 0 AND 4294967295),
    loop_start INTEGER NOT NULL CHECK (loop_start BETWEEN 0 AND 4294967295),
    PRIMARY KEY (sample_settings_id, slice_index)
);

CREATE INDEX sample_settings_root_owner
    ON sample_settings(root_id, owner_kind, source_relative_path);
