ALTER TABLE state_documents ADD COLUMN compatibility_evidence TEXT CHECK (
    compatibility_evidence IS NULL
    OR compatibility_evidence IN ('upstream_library', 'verified_master_octa_fixture')
);
