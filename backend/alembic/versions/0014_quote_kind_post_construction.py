"""quotes: allow the post_construction kind

Revision ID: 0014
Revises: 0013
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE quotes DROP CONSTRAINT quotes_kind;
        ALTER TABLE quotes ADD CONSTRAINT quotes_kind CHECK (kind IN ('airbnb', 'commercial', 'post_construction'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE quotes DROP CONSTRAINT quotes_kind;
        ALTER TABLE quotes ADD CONSTRAINT quotes_kind CHECK (kind IN ('airbnb', 'commercial'));
        """
    )
