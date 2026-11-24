"""the shared task list: tasks, their categories, and who each task is for

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- One optional emoji per category; names are unique ignoring case.
        CREATE TABLE task_categories (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name text NOT NULL,
          icon text,
          created_by bigint NOT NULL REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT task_categories_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
          CONSTRAINT task_categories_icon CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16)
        );
        CREATE UNIQUE INDEX task_categories_name_ci ON task_categories (lower(name));

        -- A task is to do or done. Dates are wall-clock dates in the company time zone (America/Toronto).
        CREATE TABLE tasks (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          title text NOT NULL,
          description text,
          icon text,
          category_id bigint REFERENCES task_categories(id) ON DELETE SET NULL,
          status text NOT NULL DEFAULT 'pending',
          due_date date,
          completed_at timestamptz,
          completed_by bigint REFERENCES users(id),
          show_on_dashboard boolean NOT NULL DEFAULT true,
          created_by bigint NOT NULL REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_by bigint NOT NULL REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT tasks_title_not_blank CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
          CONSTRAINT tasks_description_length CHECK (description IS NULL OR char_length(description) <= 2000),
          CONSTRAINT tasks_icon CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16),
          CONSTRAINT tasks_status CHECK (status IN ('pending', 'completed')),
          CONSTRAINT tasks_completed_consistent CHECK ((status = 'completed') = (completed_at IS NOT NULL))
        );
        CREATE INDEX ix_tasks_status_due ON tasks (status, due_date);
        CREATE INDEX ix_tasks_category ON tasks (category_id);

        -- The people a task is for. No rows = the whole team.
        CREATE TABLE task_people (
          task_id bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (task_id, user_id)
        );
        CREATE INDEX ix_task_people_user ON task_people (user_id);

        GRANT SELECT, INSERT, UPDATE, DELETE ON task_categories, tasks, task_people TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE task_people, tasks, task_categories;")
