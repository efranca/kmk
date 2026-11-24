"""the shared schedule: events, who they are for, one-off changes, reminders

Revision ID: 0006
Revises: 0005
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        -- One row per event or repeating series. Dates and times are wall-clock values in the company time zone
        -- (America/Toronto); recurrence is the repeat rule as JSON (null = does not repeat).
        CREATE TABLE events (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          title text NOT NULL,
          notes text,
          icon text,
          color text,
          all_day boolean NOT NULL DEFAULT false,
          start_date date NOT NULL,
          start_time time,
          duration_minutes integer,
          recurrence jsonb,
          ends_on date,
          max_count integer,
          created_by bigint NOT NULL REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_by bigint NOT NULL REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT events_title_not_blank CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
          CONSTRAINT events_timed CHECK ((all_day AND start_time IS NULL) OR (NOT all_day AND start_time IS NOT NULL)),
          CONSTRAINT events_duration CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
          CONSTRAINT events_color CHECK (color IS NULL OR color IN
            ('red','orange','amber','green','teal','blue','violet','pink')),
          CONSTRAINT events_end_rule CHECK (ends_on IS NULL OR max_count IS NULL),
          CONSTRAINT events_end_needs_recurrence CHECK (recurrence IS NOT NULL OR (ends_on IS NULL AND max_count IS NULL)),
          CONSTRAINT events_max_count CHECK (max_count IS NULL OR max_count >= 1)
        );
        CREATE INDEX ix_events_start_date ON events (start_date);

        -- The people an event is for. No rows = everyone.
        CREATE TABLE event_people (
          event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (event_id, user_id)
        );
        CREATE INDEX ix_event_people_user ON event_people (user_id);

        -- "This occurrence only" changes: one row per original occurrence date that was cancelled or modified.
        -- The nullable columns are the overrides of a modified occurrence (null keeps the series' value).
        CREATE TABLE event_exceptions (
          event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          original_date date NOT NULL,
          cancelled boolean NOT NULL DEFAULT false,
          title text,
          notes text,
          start_date date,
          start_time time,
          duration_minutes integer,
          PRIMARY KEY (event_id, original_date),
          CONSTRAINT event_exceptions_title_not_blank CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 200),
          CONSTRAINT event_exceptions_duration CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440)
        );

        -- Up to 10 per event (a service rule): "amount unit before the start".
        CREATE TABLE event_reminders (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          amount integer NOT NULL,
          unit text NOT NULL,
          CONSTRAINT event_reminders_unit CHECK (unit IN ('hours','days','weeks')),
          CONSTRAINT event_reminders_amount CHECK (amount BETWEEN 1 AND 99)
        );
        CREATE INDEX ix_event_reminders_event ON event_reminders (event_id);

        -- A person dismissed the reminder of one occurrence of an event.
        CREATE TABLE reminder_dismissals (
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          occurrence_date date NOT NULL,
          dismissed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, event_id, occurrence_date)
        );

        GRANT SELECT, INSERT, UPDATE, DELETE ON
          events, event_people, event_exceptions, event_reminders, reminder_dismissals TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TABLE reminder_dismissals, event_reminders, event_exceptions, event_people, events;"
    )
