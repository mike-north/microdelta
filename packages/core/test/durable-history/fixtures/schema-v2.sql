-- Frozen production History v2 schema from commit 2a640ac.
-- This fixture must remain independent of the current schema factory.
CREATE TABLE history_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_name TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    logical_store TEXT NOT NULL CHECK (length(logical_store) > 0)
  ) STRICT;

CREATE TABLE history_writer (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_fence INTEGER NOT NULL CHECK (last_fence >= 0),
    holder TEXT CHECK (holder IS NULL OR length(holder) > 0),
    expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
    time_high_water INTEGER NOT NULL CHECK (time_high_water >= 0)
  ) STRICT;

CREATE TABLE history_sequences (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_attempt INTEGER NOT NULL CHECK (last_attempt >= 0),
    last_publication INTEGER NOT NULL CHECK (last_publication >= 0),
    last_acceptance INTEGER NOT NULL CHECK (last_acceptance >= 0),
    last_promotion INTEGER NOT NULL CHECK (last_promotion >= 0),
    last_journal INTEGER NOT NULL CHECK (last_journal >= 0)
  ) STRICT;

CREATE TABLE history_attempts (
    attempt_id INTEGER PRIMARY KEY CHECK (attempt_id > 0),
    analysis TEXT NOT NULL CHECK (length(analysis) > 0),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    subject TEXT NOT NULL CHECK (length(subject) > 0),
    version INTEGER NOT NULL CHECK (version > 0),
    attempt_key TEXT NOT NULL CHECK (length(attempt_key) > 0),
    intent_digest TEXT NOT NULL CHECK (length(intent_digest) > 0),
    state TEXT NOT NULL CHECK (state IN ('allocated', 'staged', 'completed', 'failed', 'interrupted')),
    allocated_fence INTEGER NOT NULL CHECK (allocated_fence > 0),
    ended_fence INTEGER CHECK (ended_fence IS NULL OR ended_fence > 0),
    staged_payload TEXT,
    staged_provenance_format TEXT,
    staged_provenance_version INTEGER,
    staged_provenance TEXT,
    outcome_format TEXT,
    outcome_version INTEGER,
    outcome TEXT,
    UNIQUE (analysis, environment, subject, attempt_key),
    UNIQUE (attempt_id, analysis, environment, subject, version),
    CHECK ((staged_payload IS NULL) = (staged_provenance IS NULL)
      AND (staged_payload IS NULL) = (staged_provenance_format IS NULL)
      AND (staged_payload IS NULL) = (staged_provenance_version IS NULL)),
    CHECK ((outcome IS NULL) = (outcome_format IS NULL) AND (outcome IS NULL) = (outcome_version IS NULL)),
    CHECK ((state = 'allocated' AND staged_payload IS NULL AND ended_fence IS NULL AND outcome IS NULL)
      OR (state = 'staged' AND staged_payload IS NOT NULL AND ended_fence IS NULL AND outcome IS NULL)
      OR (state = 'completed' AND staged_payload IS NULL AND ended_fence IS NOT NULL AND outcome IS NULL)
      OR (state IN ('failed', 'interrupted') AND ended_fence IS NOT NULL AND outcome IS NOT NULL))
  ) STRICT;

CREATE TABLE history_results (
    result_id INTEGER PRIMARY KEY,
    analysis TEXT NOT NULL,
    environment TEXT NOT NULL,
    subject TEXT NOT NULL,
    version INTEGER NOT NULL,
    publication INTEGER NOT NULL UNIQUE CHECK (publication > 0),
    published_fence INTEGER NOT NULL CHECK (published_fence > 0),
    encoding TEXT NOT NULL,
    index_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    provenance_format TEXT NOT NULL,
    provenance_version INTEGER NOT NULL,
    provenance TEXT NOT NULL,
    UNIQUE (result_id, analysis, environment, subject),
    FOREIGN KEY (result_id, analysis, environment, subject, version)
      REFERENCES history_attempts (attempt_id, analysis, environment, subject, version)
  ) STRICT;

CREATE INDEX history_results_by_subject ON history_results (analysis, environment, subject, version, publication);

CREATE TABLE history_dependencies (
    attempt_id INTEGER NOT NULL REFERENCES history_attempts (attempt_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    dependency_id INTEGER NOT NULL REFERENCES history_results (result_id),
    PRIMARY KEY (attempt_id, position)
  ) STRICT;

CREATE TABLE history_nodes (
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    node_id INTEGER NOT NULL CHECK (node_id >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('scalar', 'record', 'array')),
    scalar TEXT,
    array_length INTEGER,
    own_keys TEXT,
    prototype TEXT CHECK (prototype IS NULL OR prototype IN ('null', 'object', 'custom')),
    prototype_node INTEGER,
    terminal TEXT CHECK (terminal IS NULL OR terminal IN ('null', 'object')),
    snapshot_fingerprint TEXT NOT NULL,
    PRIMARY KEY (result_id, node_id),
    CHECK ((kind = 'scalar' AND scalar IS NOT NULL AND array_length IS NULL AND own_keys IS NULL
        AND prototype IS NULL AND prototype_node IS NULL AND terminal IS NULL)
      OR (kind = 'array' AND scalar IS NULL AND array_length IS NOT NULL AND array_length >= 0 AND own_keys IS NULL
        AND prototype IS NULL AND prototype_node IS NULL AND terminal IS NULL)
      OR (kind = 'record' AND scalar IS NULL AND array_length IS NULL AND own_keys IS NOT NULL
        AND prototype IS NOT NULL AND terminal IS NOT NULL AND (prototype = 'custom') = (prototype_node IS NOT NULL)))
  ) STRICT;

CREATE TABLE history_edges (
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    parent_node INTEGER NOT NULL,
    edge_kind TEXT NOT NULL CHECK (edge_kind IN ('property', 'index')),
    edge_key TEXT NOT NULL,
    position INTEGER NOT NULL,
    child_node INTEGER NOT NULL,
    PRIMARY KEY (result_id, parent_node, edge_kind, edge_key)
  ) STRICT;

CREATE TABLE history_addresses (
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    address TEXT NOT NULL,
    node_id INTEGER NOT NULL,
    own INTEGER NOT NULL CHECK (own IN (0, 1)),
    value_fingerprint TEXT,
    PRIMARY KEY (result_id, address),
    CHECK ((address = '[]') = (value_fingerprint IS NULL))
  ) STRICT;

CREATE TABLE history_current (
    analysis TEXT NOT NULL,
    environment TEXT NOT NULL,
    subject TEXT NOT NULL,
    result_id INTEGER NOT NULL,
    PRIMARY KEY (analysis, environment, subject),
    FOREIGN KEY (result_id, analysis, environment, subject)
      REFERENCES history_results (result_id, analysis, environment, subject)
  ) STRICT;

CREATE TABLE history_acceptances (
    acceptance_id INTEGER PRIMARY KEY CHECK (acceptance_id > 0),
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    fence INTEGER NOT NULL CHECK (fence > 0),
    evidence_format TEXT NOT NULL,
    evidence_version INTEGER NOT NULL,
    evidence TEXT NOT NULL
  ) STRICT;

CREATE INDEX history_acceptances_by_result ON history_acceptances (result_id, environment, acceptance_id);

CREATE TABLE history_acceptance_dependencies (
    acceptance_id INTEGER NOT NULL REFERENCES history_acceptances (acceptance_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    dependency_id INTEGER NOT NULL REFERENCES history_results (result_id),
    PRIMARY KEY (acceptance_id, position)
  ) STRICT;

CREATE TABLE history_promotions (
    promotion_id INTEGER PRIMARY KEY CHECK (promotion_id > 0),
    analysis TEXT NOT NULL CHECK (length(analysis) > 0),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    fence INTEGER NOT NULL CHECK (fence > 0),
    evidence_format TEXT NOT NULL,
    evidence_version INTEGER NOT NULL,
    evidence TEXT NOT NULL
  ) STRICT;

CREATE INDEX history_promotions_by_target ON history_promotions (analysis, environment, promotion_id);

CREATE TABLE history_promotion_results (
    promotion_id INTEGER NOT NULL REFERENCES history_promotions (promotion_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    result_id INTEGER NOT NULL REFERENCES history_results (result_id),
    PRIMARY KEY (promotion_id, position),
    UNIQUE (promotion_id, result_id)
  ) STRICT;

CREATE INDEX history_promotion_results_by_result ON history_promotion_results (result_id, promotion_id);

CREATE TABLE history_journal (
    analysis TEXT NOT NULL CHECK (length(analysis) > 0),
    environment TEXT NOT NULL CHECK (length(environment) > 0),
    collection TEXT NOT NULL CHECK (length(collection) > 0),
    journal_key TEXT NOT NULL CHECK (length(journal_key) > 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
    fence INTEGER NOT NULL CHECK (fence > 0),
    format TEXT NOT NULL CHECK (length(format) > 0),
    format_version INTEGER NOT NULL CHECK (format_version > 0),
    content TEXT NOT NULL,
    PRIMARY KEY (analysis, environment, collection, journal_key, revision)
  ) STRICT;

CREATE TRIGGER history_identity_immutable_update BEFORE UPDATE ON history_identity
    BEGIN SELECT RAISE(ABORT, 'history_identity rows are immutable history'); END;

CREATE TRIGGER history_identity_immutable_delete BEFORE DELETE ON history_identity
    BEGIN SELECT RAISE(ABORT, 'history_identity rows are immutable history'); END;

CREATE TRIGGER history_results_immutable_update BEFORE UPDATE ON history_results
    BEGIN SELECT RAISE(ABORT, 'history_results rows are immutable history'); END;

CREATE TRIGGER history_results_immutable_delete BEFORE DELETE ON history_results
    BEGIN SELECT RAISE(ABORT, 'history_results rows are immutable history'); END;

CREATE TRIGGER history_dependencies_immutable_update BEFORE UPDATE ON history_dependencies
    BEGIN SELECT RAISE(ABORT, 'history_dependencies rows are immutable history'); END;

CREATE TRIGGER history_dependencies_immutable_delete BEFORE DELETE ON history_dependencies
    BEGIN SELECT RAISE(ABORT, 'history_dependencies rows are immutable history'); END;

CREATE TRIGGER history_nodes_immutable_update BEFORE UPDATE ON history_nodes
    BEGIN SELECT RAISE(ABORT, 'history_nodes rows are immutable history'); END;

CREATE TRIGGER history_nodes_immutable_delete BEFORE DELETE ON history_nodes
    BEGIN SELECT RAISE(ABORT, 'history_nodes rows are immutable history'); END;

CREATE TRIGGER history_edges_immutable_update BEFORE UPDATE ON history_edges
    BEGIN SELECT RAISE(ABORT, 'history_edges rows are immutable history'); END;

CREATE TRIGGER history_edges_immutable_delete BEFORE DELETE ON history_edges
    BEGIN SELECT RAISE(ABORT, 'history_edges rows are immutable history'); END;

CREATE TRIGGER history_addresses_immutable_update BEFORE UPDATE ON history_addresses
    BEGIN SELECT RAISE(ABORT, 'history_addresses rows are immutable history'); END;

CREATE TRIGGER history_addresses_immutable_delete BEFORE DELETE ON history_addresses
    BEGIN SELECT RAISE(ABORT, 'history_addresses rows are immutable history'); END;

CREATE TRIGGER history_acceptances_immutable_update BEFORE UPDATE ON history_acceptances
    BEGIN SELECT RAISE(ABORT, 'history_acceptances rows are immutable history'); END;

CREATE TRIGGER history_acceptances_immutable_delete BEFORE DELETE ON history_acceptances
    BEGIN SELECT RAISE(ABORT, 'history_acceptances rows are immutable history'); END;

CREATE TRIGGER history_acceptance_dependencies_immutable_update BEFORE UPDATE ON history_acceptance_dependencies
    BEGIN SELECT RAISE(ABORT, 'history_acceptance_dependencies rows are immutable history'); END;

CREATE TRIGGER history_acceptance_dependencies_immutable_delete BEFORE DELETE ON history_acceptance_dependencies
    BEGIN SELECT RAISE(ABORT, 'history_acceptance_dependencies rows are immutable history'); END;

CREATE TRIGGER history_promotions_immutable_update BEFORE UPDATE ON history_promotions
    BEGIN SELECT RAISE(ABORT, 'history_promotions rows are immutable history'); END;

CREATE TRIGGER history_promotions_immutable_delete BEFORE DELETE ON history_promotions
    BEGIN SELECT RAISE(ABORT, 'history_promotions rows are immutable history'); END;

CREATE TRIGGER history_promotion_results_immutable_update BEFORE UPDATE ON history_promotion_results
    BEGIN SELECT RAISE(ABORT, 'history_promotion_results rows are immutable history'); END;

CREATE TRIGGER history_promotion_results_immutable_delete BEFORE DELETE ON history_promotion_results
    BEGIN SELECT RAISE(ABORT, 'history_promotion_results rows are immutable history'); END;

CREATE TRIGGER history_journal_immutable_update BEFORE UPDATE ON history_journal
    BEGIN SELECT RAISE(ABORT, 'history_journal rows are immutable history'); END;

CREATE TRIGGER history_journal_immutable_delete BEFORE DELETE ON history_journal
    BEGIN SELECT RAISE(ABORT, 'history_journal rows are immutable history'); END;

CREATE TRIGGER history_writer_immutable_delete BEFORE DELETE ON history_writer
    BEGIN SELECT RAISE(ABORT, 'history_writer rows are immutable history and are never deleted'); END;

CREATE TRIGGER history_sequences_immutable_delete BEFORE DELETE ON history_sequences
    BEGIN SELECT RAISE(ABORT, 'history_sequences rows are immutable history and are never deleted'); END;

CREATE TRIGGER history_attempts_immutable_delete BEFORE DELETE ON history_attempts
    BEGIN SELECT RAISE(ABORT, 'history_attempts rows are immutable history and are never deleted'); END;

CREATE TRIGGER history_current_immutable_delete BEFORE DELETE ON history_current
    BEGIN SELECT RAISE(ABORT, 'history_current rows are immutable history and are never deleted'); END;

CREATE TRIGGER history_attempts_identity_immutable
    BEFORE UPDATE OF attempt_id, analysis, environment, subject, version, attempt_key, intent_digest, allocated_fence
    ON history_attempts
    BEGIN SELECT RAISE(ABORT, 'history_attempts identity is immutable history'); END;

INSERT INTO history_identity VALUES (1, 'microdelta.history.durable', 2, 'store:contributors');
INSERT INTO history_writer VALUES (1, 0, NULL, 0, 0);
INSERT INTO history_sequences VALUES (1, 0, 0, 0, 0, 0);

-- Historical journal evidence must survive a rejected open unchanged.
INSERT INTO history_journal VALUES ('analysis:contributors', 'env:fixture', 'operations', 'old-operation', 1, 1, 1, 'test.record', 1, '{}');
