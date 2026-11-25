"""quote requests: quotes, photos, messages, system settings, push subscriptions

Revision ID: 0013
Revises: 0012
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

# The category of the task each quote creates: added only if no category has that name yet (ignoring case).
SEED_SQL = """
INSERT INTO task_categories (name, icon)
SELECT 'Quotes', '📋'
WHERE NOT EXISTS (SELECT 1 FROM task_categories c WHERE lower(c.name) = 'quotes');
"""


def upgrade() -> None:
    op.execute(
        """
        -- Rows made by the website have no creator.
        ALTER TABLE tasks ALTER COLUMN created_by DROP NOT NULL, ALTER COLUMN updated_by DROP NOT NULL;
        ALTER TABLE events ALTER COLUMN created_by DROP NOT NULL, ALTER COLUMN updated_by DROP NOT NULL;

        CREATE TABLE quotes (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          status text NOT NULL DEFAULT 'draft',
          kind text NOT NULL,
          name text NOT NULL,
          email text NOT NULL,
          phone text NOT NULL,
          locale text NOT NULL,
          details jsonb NOT NULL DEFAULT '{}'::jsonb,
          message text,
          internal_note text,
          ip text NOT NULL,
          ip_key text NOT NULL,
          geo_country text,
          geo_city text,
          user_agent text,
          token_hash text NOT NULL,
          deadline_at timestamptz,
          first_reply_at timestamptz,
          task_id bigint REFERENCES tasks(id) ON DELETE SET NULL,
          event_id bigint REFERENCES events(id) ON DELETE SET NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          submitted_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT quotes_status CHECK (status IN ('draft', 'new', 'replied', 'customer_replied', 'won', 'lost')),
          CONSTRAINT quotes_kind CHECK (kind IN ('airbnb', 'commercial')),
          CONSTRAINT quotes_locale CHECK (locale IN ('fr-CA', 'en-CA', 'pt-BR'))
        );
        CREATE INDEX quotes_ip_idx ON quotes (ip_key, created_at);
        CREATE INDEX quotes_status_idx ON quotes (status, submitted_at);

        CREATE TABLE quote_photos (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          quote_id bigint NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
          content_type text NOT NULL,
          size integer NOT NULL,
          data bytea NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT quote_photos_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic'))
        );
        CREATE INDEX quote_photos_quote_idx ON quote_photos (quote_id);

        CREATE TABLE quote_messages (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          quote_id bigint NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
          direction text NOT NULL,
          subject text,
          body text NOT NULL,
          author_id bigint REFERENCES users(id),
          sent_at timestamptz NOT NULL,
          delivery text,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT quote_messages_direction CHECK (direction IN ('out', 'in')),
          CONSTRAINT quote_messages_delivery CHECK (delivery IN ('sent', 'failed')),
          CONSTRAINT quote_messages_out_has_delivery CHECK ((direction = 'out') = (delivery IS NOT NULL))
        );
        CREATE INDEX quote_messages_quote_idx ON quote_messages (quote_id, sent_at);

        CREATE TABLE app_settings (
          key text PRIMARY KEY,
          value text NOT NULL,
          updated_by bigint REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE push_subscriptions (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint text NOT NULL UNIQUE,
          p256dh text NOT NULL,
          auth text NOT NULL,
          user_agent text,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_used_at timestamptz
        );
        CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

        GRANT SELECT, INSERT, UPDATE, DELETE ON quotes, quote_photos, quote_messages, app_settings, push_subscriptions TO kmk_app;
        """
    )
    op.execute(SEED_SQL)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE push_subscriptions; DROP TABLE app_settings; DROP TABLE quote_messages; DROP TABLE quote_photos; DROP TABLE quotes;
        DELETE FROM task_categories WHERE name = 'Quotes' AND created_by IS NULL;
        DELETE FROM tasks WHERE created_by IS NULL OR updated_by IS NULL;
        DELETE FROM events WHERE created_by IS NULL OR updated_by IS NULL;
        ALTER TABLE tasks ALTER COLUMN created_by SET NOT NULL, ALTER COLUMN updated_by SET NOT NULL;
        ALTER TABLE events ALTER COLUMN created_by SET NOT NULL, ALTER COLUMN updated_by SET NOT NULL;
        """
    )
