"""manual_quotes: quotes can be entered by hand (a phone call); who entered it, and where it came from

Revision ID: 0021
Revises: 0020
"""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE quotes ADD COLUMN source text NOT NULL DEFAULT 'web';
        ALTER TABLE quotes ADD COLUMN created_by bigint REFERENCES users(id);
        ALTER TABLE quotes ADD CONSTRAINT quotes_source_valid CHECK (source IN ('web', 'manual'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE quotes DROP COLUMN created_by;
        ALTER TABLE quotes DROP COLUMN source;
        """
    )
