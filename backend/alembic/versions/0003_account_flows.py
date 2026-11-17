"""tokens table, invited status, nullable password hash, rate-limit kinds

Revision ID: 0003
Revises: 0002
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
        ALTER TABLE users DROP CONSTRAINT users_status_valid;
        ALTER TABLE users ADD CONSTRAINT users_status_valid
          CHECK (status IN ('invited','active','disabled','deleted'));

        CREATE TABLE tokens (
          token_hash varchar(64) PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id),
          purpose text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          used_at timestamptz,
          CONSTRAINT tokens_purpose_valid CHECK (purpose IN ('invite','reset'))
        );
        CREATE INDEX tokens_user_id_idx ON tokens (user_id);

        ALTER TABLE login_attempts ADD COLUMN kind text NOT NULL DEFAULT 'login';
        ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_kind_valid
          CHECK (kind IN ('login','reset_request','token'));

        GRANT SELECT, INSERT, UPDATE, DELETE ON tokens TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_kind_valid;
        ALTER TABLE login_attempts DROP COLUMN kind;
        DROP TABLE tokens;
        ALTER TABLE users DROP CONSTRAINT users_status_valid;
        ALTER TABLE users ADD CONSTRAINT users_status_valid CHECK (status IN ('active','disabled','deleted'));
        ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
        """
    )
