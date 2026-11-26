"""calendar_feeds: one personal .ics feed token per user; a "feed" kind for its rate limit

Revision ID: 0015
Revises: 0014
"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE calendar_feeds (
          user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          token_hash text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_feeds TO kmk_app;

        ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_kind_valid;
        ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_kind_valid
          CHECK (kind IN ('login','reset_request','token','mfa','feed'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM login_attempts WHERE kind = 'feed';
        ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_kind_valid;
        ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_kind_valid
          CHECK (kind IN ('login','reset_request','token','mfa'));
        DROP TABLE calendar_feeds;
        """
    )
