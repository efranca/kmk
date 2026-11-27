"""properties: the places a client owns (one client, several properties); an Agenda item can say which one it is for

Revision ID: 0019
Revises: 0018
"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE properties (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          client_id bigint NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          name text NOT NULL,
          kind text NOT NULL DEFAULT 'other',
          address text,
          city text,
          listing_url text,
          access_notes text,
          created_by bigint REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_by bigint REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT properties_name_valid CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
          CONSTRAINT properties_kind_valid CHECK (kind IN ('airbnb','commercial','post_construction','other'))
        );
        CREATE INDEX properties_client_idx ON properties (client_id);
        GRANT SELECT, INSERT, UPDATE, DELETE ON properties TO kmk_app;

        ALTER TABLE events ADD COLUMN property_id bigint REFERENCES properties(id) ON DELETE SET NULL;
        CREATE INDEX events_property_idx ON events (property_id) WHERE property_id IS NOT NULL;

        -- Each client's address becomes their first property, so nothing already entered is lost.
        INSERT INTO properties (client_id, name, kind, address, city)
        SELECT id, left(coalesce(nullif(btrim(address), ''), btrim(city)), 100), kinds[1], address, city
        FROM clients WHERE nullif(btrim(coalesce(address, '')), '') IS NOT NULL OR nullif(btrim(coalesce(city, '')), '') IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE events DROP COLUMN property_id;
        DROP TABLE properties;
        """
    )
