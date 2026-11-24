"""connected devices: a public id and last access for each session

Revision ID: 0010
Revises: 0009
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- The public handle of a session (the token hash is never shown or sent).
        ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
        CREATE UNIQUE INDEX sessions_id_idx ON sessions (id);

        -- Last access, written at most once every 5 minutes per session. Location comes from Cloudflare's headers
        -- (approximate, informational only).
        ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
        UPDATE sessions SET last_seen_at = created_at;
        ALTER TABLE sessions ADD COLUMN last_ip text;
        ALTER TABLE sessions ADD COLUMN country char(2);
        ALTER TABLE sessions ADD COLUMN city varchar(100);
        ALTER TABLE sessions ADD CONSTRAINT sessions_country_check CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE sessions DROP CONSTRAINT sessions_country_check;
        ALTER TABLE sessions DROP COLUMN city, DROP COLUMN country, DROP COLUMN last_ip, DROP COLUMN last_seen_at;
        DROP INDEX sessions_id_idx;
        ALTER TABLE sessions DROP COLUMN id;
        """
    )
