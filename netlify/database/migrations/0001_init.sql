-- bike_view schema, ported from the original SQLite database (app/db.py).
--
-- Type notes for wire-format parity with the Python app:
--   * INTEGER (int4) ids — BIGINT comes back from node-postgres as a string.
--   * is_primary is SMALLINT (0/1), not BOOLEAN — the frontend consumes ints.
--   * cost is DOUBLE PRECISION — NUMERIC comes back as a string.
--   * acquired_on/retired_on/date stay TEXT (the UI treats them as plain
--     date strings; SQLite stored them as TEXT).

CREATE TABLE bikes (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    full_story    TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'former')),
    acquired_on   TEXT,
    retired_on    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pills (
    id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    label TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6b7280'
);

CREATE TABLE bike_pills (
    bike_id INTEGER NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
    pill_id INTEGER NOT NULL REFERENCES pills(id) ON DELETE CASCADE,
    PRIMARY KEY (bike_id, pill_id)
);

CREATE TABLE maintenance_records (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bike_id     INTEGER NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    description TEXT NOT NULL,
    cost        DOUBLE PRECISION,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE images (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bike_id       INTEGER NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    is_primary    SMALLINT NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
