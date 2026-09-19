CREATE TABLE asset_derivations (
    id INTEGER PRIMARY KEY,
    output_audio_asset_id INTEGER NOT NULL UNIQUE
        REFERENCES audio_assets(id) ON DELETE RESTRICT,
    source_audio_asset_id INTEGER NOT NULL
        REFERENCES audio_assets(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (
        kind IN (
            'TRIM',
            'NORMALIZE',
            'RESAMPLE',
            'BIT_DEPTH_CONVERT',
            'SLICE_EXPORT',
            'SAMPLE_CHAIN',
            'STEM',
            'NODE_RECORDING_PROCESS',
            'IMPORT_PROCESS'
        )
    ),
    processor_name TEXT NOT NULL CHECK (
        length(processor_name) BETWEEN 1 AND 128
        AND processor_name = trim(processor_name)
    ),
    processor_revision TEXT NOT NULL CHECK (
        length(processor_revision) BETWEEN 1 AND 64
        AND processor_revision = trim(processor_revision)
    ),
    parameters_envelope TEXT NOT NULL CHECK (
        length(parameters_envelope) BETWEEN 1 AND 256
        AND parameters_envelope LIKE 'v1|%'
    ),
    source_hash_evidence TEXT NOT NULL CHECK (
        length(source_hash_evidence) = 71
        AND substr(source_hash_evidence, 1, 7) = 'sha256:'
    ),
    created_at TEXT NOT NULL CHECK (
        length(created_at) BETWEEN 1 AND 40
    ),
    CHECK (output_audio_asset_id <> source_audio_asset_id)
);

CREATE INDEX asset_derivations_source
    ON asset_derivations(source_audio_asset_id);

CREATE TRIGGER asset_derivations_prevent_cycle_insert
BEFORE INSERT ON asset_derivations
BEGIN
    SELECT RAISE(ABORT, 'derivation cycle')
    WHERE EXISTS (
        WITH RECURSIVE lineage(node_id) AS (
            SELECT NEW.source_audio_asset_id
            UNION ALL
            SELECT asset_derivations.source_audio_asset_id
            FROM asset_derivations
            JOIN lineage ON asset_derivations.output_audio_asset_id = lineage.node_id
        )
        SELECT 1 FROM lineage WHERE node_id = NEW.output_audio_asset_id
    );
END;
