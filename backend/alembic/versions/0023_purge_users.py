"""deleting a person for good: what they made stays (author set to NULL), their sign-ins go with them

Revision ID: 0023
Revises: 0022
"""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

# (table, column, was NOT NULL)
AUTHORS = [
    ("events", "created_by", True), ("events", "updated_by", True),
    ("task_categories", "created_by", False),
    ("clients", "created_by", False), ("clients", "updated_by", False),
    ("properties", "created_by", False), ("properties", "updated_by", False),
    ("tasks", "completed_by", False), ("tasks", "created_by", True), ("tasks", "updated_by", True),
    ("document_categories", "created_by", False),
    ("documents", "created_by", True), ("documents", "updated_by", True),
    ("quotes", "created_by", False), ("quote_messages", "author_id", False), ("app_settings", "updated_by", False),
    ("invoices", "created_by", False), ("invoices", "updated_by", False),
]
OWNED = [("sessions", "user_id"), ("tokens", "user_id"), ("recovery_codes", "user_id")]


def _swap(table: str, column: str, rule: str) -> str:
    return (
        f"ALTER TABLE {table} DROP CONSTRAINT {table}_{column}_fkey;\n"
        f"ALTER TABLE {table} ADD CONSTRAINT {table}_{column}_fkey FOREIGN KEY ({column}) REFERENCES users(id) ON DELETE {rule};\n"
    )


def upgrade() -> None:
    sql = ""
    for table, column, not_null in AUTHORS:
        if not_null:
            sql += f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL;\n"
        sql += _swap(table, column, "SET NULL")
    for table, column in OWNED:
        sql += _swap(table, column, "CASCADE")
    op.execute(sql)


def downgrade() -> None:
    sql = ""
    for table, column, _ in AUTHORS:
        sql += _swap(table, column, "NO ACTION")  # the NOT NULLs stay off: rows may already have no author
    for table, column in OWNED:
        sql += _swap(table, column, "NO ACTION")
    op.execute(sql)
