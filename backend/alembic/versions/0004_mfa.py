"""TOTP: replay-protection step, session verification flag, recovery codes, 'mfa' rate-limit kind

Revision ID: 0004
Revises: 0003
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users ADD COLUMN mfa_last_step bigint;
        ALTER TABLE sessions ADD COLUMN mfa_verified boolean NOT NULL DEFAULT true;

        CREATE TABLE recovery_codes (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id),
          code_hash varchar(64) NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          used_at timestamptz
        );
        CREATE INDEX recovery_codes_user_id_idx ON recovery_codes (user_id);

        ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_kind_valid;
        ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_kind_valid
          CHECK (kind IN ('login','reset_request','token','mfa'));

        GRANT SELECT, INSERT, UPDATE, DELETE ON recovery_codes TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE login_attempts DROP CONSTRAINT login_attempts_kind_valid;
        ALTER TABLE login_attempts ADD CONSTRAINT login_attempts_kind_valid
          CHECK (kind IN ('login','reset_request','token'));
        DROP TABLE recovery_codes;
        ALTER TABLE sessions DROP COLUMN mfa_verified;
        ALTER TABLE users DROP COLUMN mfa_last_step;
        """
    )
