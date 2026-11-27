"""client_kinds: a client can be several kinds at once (Airbnb and Commercial, say)

Revision ID: 0018
Revises: 0017
"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE clients ADD COLUMN kinds text[] NOT NULL DEFAULT ARRAY['other']::text[];
        UPDATE clients SET kinds = ARRAY[kind];
        ALTER TABLE clients DROP CONSTRAINT clients_kind_valid;
        ALTER TABLE clients DROP COLUMN kind;
        ALTER TABLE clients ADD CONSTRAINT clients_kinds_valid CHECK (
          cardinality(kinds) BETWEEN 1 AND 4 AND kinds <@ ARRAY['airbnb','commercial','post_construction','other']::text[]
        );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE clients ADD COLUMN kind text NOT NULL DEFAULT 'other';
        UPDATE clients SET kind = kinds[1];
        ALTER TABLE clients DROP CONSTRAINT clients_kinds_valid;
        ALTER TABLE clients DROP COLUMN kinds;
        ALTER TABLE clients ADD CONSTRAINT clients_kind_valid CHECK (kind IN ('airbnb','commercial','post_construction','other'));
        """
    )
