"""users, sessions, audit_log, login_attempts, kmk_app grants

Revision ID: 0002
Revises: 0001
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kmk_app') THEN
            RAISE EXCEPTION 'role kmk_app must exist before this migration (create it with psql, see the phase 2 plan)';
          END IF;
        END $$;
        """
    )
    op.execute(
        """
        CREATE TABLE users (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          username text NOT NULL UNIQUE,
          email text NOT NULL UNIQUE,
          password_hash text NOT NULL,
          role text NOT NULL DEFAULT 'user',
          locale text NOT NULL DEFAULT 'fr-CA',
          status text NOT NULL DEFAULT 'active',
          mfa_secret text,
          mfa_enabled boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz,
          CONSTRAINT users_username_lower CHECK (username = lower(username)),
          CONSTRAINT users_email_lower CHECK (email = lower(email)),
          CONSTRAINT users_role_valid CHECK (role IN ('user','admin','superadmin')),
          CONSTRAINT users_locale_valid CHECK (locale IN ('fr-CA','en','pt-BR')),
          CONSTRAINT users_status_valid CHECK (status IN ('active','disabled','deleted'))
        );
        CREATE UNIQUE INDEX one_superadmin ON users (role) WHERE role = 'superadmin';

        CREATE TABLE sessions (
          token_hash varchar(64) PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          ip text,
          user_agent text,
          revoked_at timestamptz
        );
        CREATE INDEX sessions_user_id_idx ON sessions (user_id);

        CREATE TABLE audit_log (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          timestamp timestamptz NOT NULL DEFAULT now(),
          actor_user_id bigint,
          action text NOT NULL,
          target_user_id bigint,
          ip text,
          details jsonb
        );

        CREATE TABLE login_attempts (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          at timestamptz NOT NULL DEFAULT now(),
          ip text NOT NULL,
          identifier text NOT NULL,
          success boolean NOT NULL
        );
        CREATE INDEX login_attempts_at_idx ON login_attempts (at);

        GRANT USAGE ON SCHEMA public TO kmk_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, login_attempts TO kmk_app;
        GRANT INSERT ON audit_log TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE login_attempts, audit_log, sessions, users")
