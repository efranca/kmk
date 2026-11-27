"""clients: the people the company works for, and an optional client on tasks, events, documents and quotes

Revision ID: 0017
Revises: 0016
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE clients (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name text NOT NULL,
          kind text NOT NULL DEFAULT 'other',
          contact_name text,
          email text,
          phone text,
          address text,
          city text,
          notes text,
          created_by bigint REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_by bigint REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT clients_name_valid CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
          CONSTRAINT clients_kind_valid CHECK (kind IN ('airbnb','commercial','post_construction','other'))
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO kmk_app;

        ALTER TABLE tasks ADD COLUMN client_id bigint REFERENCES clients(id) ON DELETE SET NULL;
        ALTER TABLE events ADD COLUMN client_id bigint REFERENCES clients(id) ON DELETE SET NULL;
        ALTER TABLE documents ADD COLUMN client_id bigint REFERENCES clients(id) ON DELETE SET NULL;
        ALTER TABLE quotes ADD COLUMN client_id bigint REFERENCES clients(id) ON DELETE SET NULL;
        CREATE INDEX tasks_client_idx ON tasks (client_id) WHERE client_id IS NOT NULL;
        CREATE INDEX events_client_idx ON events (client_id) WHERE client_id IS NOT NULL;
        CREATE INDEX documents_client_idx ON documents (client_id) WHERE client_id IS NOT NULL;
        CREATE INDEX quotes_client_idx ON quotes (client_id) WHERE client_id IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE quotes DROP COLUMN client_id;
        ALTER TABLE documents DROP COLUMN client_id;
        ALTER TABLE events DROP COLUMN client_id;
        ALTER TABLE tasks DROP COLUMN client_id;
        DROP TABLE clients;
        """
    )
