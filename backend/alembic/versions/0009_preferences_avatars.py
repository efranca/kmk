"""per-account preferences and profile pictures

Revision ID: 0009
Revises: 0008
"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- One validated JSON object per person (theme, layout choices, Dashboard widgets); the application fills defaults.
        ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

        -- NULL = no picture; otherwise when it was set (the picture's address carries it, so a new picture is fetched afresh).
        ALTER TABLE users ADD COLUMN avatar_updated_at timestamptz;

        -- A profile picture: at most 50 KB, prepared by the browser; the server checks type and size again.
        CREATE TABLE user_avatars (
          user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          content_type text NOT NULL,
          data bytea NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT user_avatars_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
          CONSTRAINT user_avatars_size CHECK (octet_length(data) BETWEEN 1 AND 51200)
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON user_avatars TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE user_avatars; ALTER TABLE users DROP COLUMN avatar_updated_at; ALTER TABLE users DROP COLUMN preferences;")
