"""visits: check-in and check-out of a cleaning, its photos, skipped rooms and corrections

Revision ID: 0024
Revises: 0023
"""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE properties ADD COLUMN photos_required boolean NOT NULL DEFAULT false;

        CREATE TABLE property_rooms (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          property_id bigint NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
          name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
          position integer NOT NULL,
          UNIQUE (property_id, position)
        );

        CREATE TABLE visits (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          event_id bigint REFERENCES events(id) ON DELETE SET NULL,
          occurrence_date date NOT NULL,
          visit_date date NOT NULL,
          client_id bigint REFERENCES clients(id) ON DELETE SET NULL,
          property_id bigint REFERENCES properties(id) ON DELETE SET NULL,
          client_name text,
          property_name text NOT NULL,
          closed_at timestamptz,
          closed_by bigint REFERENCES users(id) ON DELETE SET NULL,
          closed_without_photos boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (event_id, occurrence_date)
        );
        CREATE INDEX visits_visit_date_idx ON visits (visit_date);

        CREATE TABLE visit_people (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          visit_id bigint NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
          user_id bigint REFERENCES users(id) ON DELETE SET NULL,
          user_name text NOT NULL,
          checked_in_at timestamptz NOT NULL DEFAULT now(),
          checked_in_by bigint REFERENCES users(id) ON DELETE SET NULL,
          withdrawn_at timestamptz,
          withdrawn_by bigint REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX visit_people_active ON visit_people (visit_id, user_id) WHERE withdrawn_at IS NULL;

        CREATE TABLE visit_photos (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          visit_id bigint NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
          file_id text NOT NULL UNIQUE,
          room_id bigint REFERENCES property_rooms(id) ON DELETE SET NULL,
          room_name text NOT NULL CHECK (char_length(room_name) BETWEEN 1 AND 60),
          content_type text NOT NULL CHECK (content_type IN ('image/webp','image/jpeg')),
          size integer NOT NULL CHECK (size BETWEEN 1 AND 614400),
          sha256 text NOT NULL,
          uploaded_by bigint REFERENCES users(id) ON DELETE SET NULL,
          uploaded_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz,
          deleted_by bigint REFERENCES users(id) ON DELETE SET NULL,
          purged_at timestamptz
        );
        CREATE INDEX visit_photos_visit_idx ON visit_photos (visit_id);

        CREATE TABLE visit_room_skips (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          visit_id bigint NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
          room_id bigint REFERENCES property_rooms(id) ON DELETE SET NULL,
          room_name text NOT NULL,
          reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200),
          skipped_by bigint REFERENCES users(id) ON DELETE SET NULL,
          skipped_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX visit_room_skips_visit_idx ON visit_room_skips (visit_id);

        CREATE TABLE visit_corrections (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          visit_id bigint NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
          kind text NOT NULL CHECK (kind IN ('close','withdraw','add_person','add_photo','remove_photo','skip_room','reopen')),
          actor_id bigint REFERENCES users(id) ON DELETE SET NULL,
          reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 200),
          details jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX visit_corrections_visit_idx ON visit_corrections (visit_id);

        GRANT SELECT, INSERT, UPDATE, DELETE ON property_rooms, visits, visit_people, visit_photos, visit_room_skips TO kmk_app;
        GRANT SELECT, INSERT ON visit_corrections TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE visit_corrections;
        DROP TABLE visit_room_skips;
        DROP TABLE visit_photos;
        DROP TABLE visit_people;
        DROP TABLE visits;
        DROP TABLE property_rooms;
        ALTER TABLE properties DROP COLUMN photos_required;
        """
    )
