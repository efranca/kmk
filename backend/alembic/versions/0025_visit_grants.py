"""visits: the record is append-only for the app role (no DELETE), and a plain index on visit_people.visit_id

No application path deletes a visit, a check-in, a photo row or a room skip (a removed photo is marked, a withdrawn
check-in is marked, the purge marks `purged_at`). Without DELETE the app role also cannot erase the append-only
corrections through `ON DELETE CASCADE` from `visits`. Foreign-key actions (a deleted property, room, user or event
setting a column to NULL) run as the table owner and keep working. `property_rooms` keeps DELETE (admins edit the list).

Revision ID: 0025
Revises: 0024
"""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        REVOKE DELETE ON visits, visit_people, visit_photos, visit_room_skips FROM kmk_app;
        CREATE INDEX visit_people_visit_id_idx ON visit_people (visit_id);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX visit_people_visit_id_idx;
        GRANT DELETE ON visits, visit_people, visit_photos, visit_room_skips TO kmk_app;
        """
    )
