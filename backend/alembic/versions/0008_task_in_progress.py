"""tasks can be in progress; starter task categories

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

# Starter categories: only the names that do not exist yet (ignoring case) are added, so running it twice is harmless.
# They belong to no one (created_by NULL), so this works on a database with no users yet.
SEED_SQL = """
INSERT INTO task_categories (name, icon)
SELECT v.name, v.icon
FROM (VALUES
  ('Cleaning', '🧹'), ('Supplies', '🧴'), ('Equipment', '🔧'), ('Clients', '🏠'), ('Vehicle', '🚐'),
  ('Maintenance', '🛠️'), ('Training', '🎓'), ('Safety', '🦺'), ('Admin', '📄'), ('Other', '📌')
) AS v(name, icon)
WHERE NOT EXISTS (SELECT 1 FROM task_categories c WHERE lower(c.name) = lower(v.name));
"""


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE tasks DROP CONSTRAINT tasks_status;
        ALTER TABLE tasks ADD CONSTRAINT tasks_status CHECK (status IN ('pending', 'in_progress', 'completed'));
        ALTER TABLE task_categories ALTER COLUMN created_by DROP NOT NULL;
        """
    )
    op.execute(SEED_SQL)


def downgrade() -> None:
    op.execute(
        """
        UPDATE tasks SET status = 'pending' WHERE status = 'in_progress';
        ALTER TABLE tasks DROP CONSTRAINT tasks_status;
        ALTER TABLE tasks ADD CONSTRAINT tasks_status CHECK (status IN ('pending', 'completed'));
        """
    )
