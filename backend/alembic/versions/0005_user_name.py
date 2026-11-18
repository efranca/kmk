"""a name for every person

Revision ID: 0005
Revises: 0004
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users ADD COLUMN name text;
        ALTER TABLE users ADD CONSTRAINT users_name_valid
          CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 100);
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP CONSTRAINT users_name_valid; ALTER TABLE users DROP COLUMN name;")
