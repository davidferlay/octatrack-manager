CREATE TABLE state_documents (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
    scan_session_id INTEGER NOT NULL,
    project_relative_path TEXT NOT NULL,
    source_relative_path TEXT NOT NULL,
    document_kind TEXT NOT NULL CHECK (document_kind IN ('project', 'bank')),
    document_role TEXT NOT NULL CHECK (document_role IN ('working', 'saved_checkpoint')),
    bank_index INTEGER CHECK (bank_index BETWEEN 0 AND 15),
    parse_status TEXT NOT NULL CHECK (
        parse_status IN ('parsed', 'unsupported_version', 'malformed')
    ),
    parser_name TEXT NOT NULL CHECK (length(parser_name) > 0),
    parser_revision TEXT NOT NULL CHECK (length(parser_revision) > 0),
    source_version TEXT,
    UNIQUE (root_id, source_relative_path),
    CHECK (
        (document_kind = 'project' AND bank_index IS NULL)
        OR (document_kind = 'bank' AND bank_index IS NOT NULL)
    ),
    FOREIGN KEY (scan_session_id, root_id)
        REFERENCES scan_sessions(id, root_id),
    FOREIGN KEY (root_id, project_relative_path)
        REFERENCES projects(root_id, relative_path) ON DELETE CASCADE
);

CREATE TABLE slot_assignments (
    id INTEGER PRIMARY KEY,
    state_document_id INTEGER NOT NULL
        REFERENCES state_documents(id) ON DELETE CASCADE,
    slot_kind TEXT NOT NULL CHECK (slot_kind IN ('static', 'flex')),
    slot_number INTEGER NOT NULL CHECK (
        (slot_kind = 'static' AND slot_number BETWEEN 1 AND 128)
        OR (slot_kind = 'flex' AND slot_number BETWEEN 1 AND 128)
    ),
    referenced_relative_path TEXT,
    reference_status TEXT NOT NULL CHECK (
        reference_status IN ('resolved', 'missing', 'invalid_path')
    ),
    UNIQUE (state_document_id, slot_kind, slot_number),
    CHECK (
        (reference_status IN ('resolved', 'missing') AND referenced_relative_path IS NOT NULL)
        OR (reference_status = 'invalid_path' AND referenced_relative_path IS NULL)
    )
);

CREATE TABLE usage_edges (
    id INTEGER PRIMARY KEY,
    state_document_id INTEGER NOT NULL
        REFERENCES state_documents(id) ON DELETE CASCADE,
    project_document_id INTEGER
        REFERENCES state_documents(id) ON DELETE CASCADE,
    slot_assignment_id INTEGER
        REFERENCES slot_assignments(id) ON DELETE CASCADE,
    slot_kind TEXT NOT NULL CHECK (slot_kind IN ('static', 'flex')),
    slot_number INTEGER NOT NULL CHECK (
        (slot_kind = 'static' AND slot_number BETWEEN 1 AND 128)
        OR (slot_kind = 'flex' AND slot_number BETWEEN 1 AND 128)
    ),
    usage_kind TEXT NOT NULL CHECK (usage_kind IN ('machine', 'sample_lock')),
    track_index INTEGER NOT NULL CHECK (track_index BETWEEN 0 AND 7),
    part_index INTEGER CHECK (part_index BETWEEN 0 AND 3),
    pattern_index INTEGER CHECK (pattern_index BETWEEN 0 AND 15),
    step_index INTEGER CHECK (step_index BETWEEN 0 AND 63),
    audible INTEGER NOT NULL CHECK (audible IN (0, 1)),
    referenced_relative_path TEXT,
    reference_status TEXT NOT NULL CHECK (
        reference_status IN ('resolved', 'missing', 'invalid_path', 'unassigned_slot')
    ),
    CHECK (
        (usage_kind = 'machine' AND part_index IS NOT NULL
            AND pattern_index IS NULL AND step_index IS NULL)
        OR (usage_kind = 'sample_lock' AND part_index IS NULL
            AND pattern_index IS NOT NULL AND step_index IS NOT NULL)
    ),
    CHECK (
        (reference_status IN ('resolved', 'missing')
            AND referenced_relative_path IS NOT NULL
            AND slot_assignment_id IS NOT NULL)
        OR (reference_status = 'invalid_path'
            AND referenced_relative_path IS NULL
            AND slot_assignment_id IS NOT NULL)
        OR (reference_status = 'unassigned_slot'
            AND referenced_relative_path IS NULL
            AND slot_assignment_id IS NULL)
    )
);

CREATE INDEX state_documents_root_project_role
    ON state_documents(root_id, project_relative_path, document_role, document_kind);

CREATE INDEX slot_assignments_reference
    ON slot_assignments(reference_status, referenced_relative_path);

CREATE INDEX usage_edges_reference
    ON usage_edges(reference_status, referenced_relative_path);

CREATE INDEX usage_edges_project_slot
    ON usage_edges(project_document_id, slot_kind, slot_number);
