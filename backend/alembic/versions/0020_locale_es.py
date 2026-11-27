"""locale_es: Spanish as a language for people (the private app)

Revision ID: 0020
Revises: 0019
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users DROP CONSTRAINT users_locale_valid;
        ALTER TABLE users ADD CONSTRAINT users_locale_valid CHECK (locale IN ('fr-CA','en','pt-BR','es'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE users SET locale = 'en' WHERE locale = 'es';
        ALTER TABLE users DROP CONSTRAINT users_locale_valid;
        ALTER TABLE users ADD CONSTRAINT users_locale_valid CHECK (locale IN ('fr-CA','en','pt-BR'));
        """
    )
