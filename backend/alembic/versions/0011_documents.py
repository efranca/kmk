"""the company document library: categories, documents (metadata) and their files (bytes)

Revision ID: 0011
Revises: 0010
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

# Starter categories: only names that do not exist yet (ignoring case) are added, so running it twice is harmless.
SEED_SQL = """
INSERT INTO document_categories (name, icon)
SELECT v.name, v.icon
FROM (VALUES
  ('Contracts', '📝'), ('Insurance', '🛡️'), ('HR', '👥'), ('Finance', '💰'), ('Safety', '🦺'), ('Clients', '🏠'), ('Other', '📌')
) AS v(name, icon)
WHERE NOT EXISTS (SELECT 1 FROM document_categories c WHERE lower(c.name) = lower(v.name));
"""


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE document_categories (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          name text NOT NULL,
          icon text,
          created_by bigint REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT document_categories_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
          CONSTRAINT document_categories_icon CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 16)
        );
        CREATE UNIQUE INDEX document_categories_name_ci ON document_categories (lower(name));

        -- Metadata only: lists never read the bytes. A document with no file yet (the three file columns NULL) is a
        -- pending upload: only its creator sees it, and it is purged after an hour.
        CREATE TABLE documents (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          title text NOT NULL,
          note text,
          category_id bigint REFERENCES document_categories(id) ON DELETE SET NULL,
          visibility text NOT NULL DEFAULT 'admins',
          file_name text,
          content_type text,
          size_bytes bigint,
          created_by bigint NOT NULL REFERENCES users(id),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_by bigint NOT NULL REFERENCES users(id),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT documents_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
          CONSTRAINT documents_note CHECK (note IS NULL OR char_length(note) <= 1000),
          CONSTRAINT documents_visibility CHECK (visibility IN ('everyone', 'admins', 'superadmin')),
          CONSTRAINT documents_file_all_or_none CHECK (
            (file_name IS NULL AND content_type IS NULL AND size_bytes IS NULL)
            OR (file_name IS NOT NULL AND content_type IS NOT NULL AND size_bytes IS NOT NULL)
          ),
          CONSTRAINT documents_file_name CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 200),
          CONSTRAINT documents_content_type CHECK (content_type IS NULL OR content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
          CONSTRAINT documents_size CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 52428800)
        );
        CREATE INDEX documents_category_idx ON documents (category_id);

        -- The bytes (at most 50 MB), apart from the metadata so a list never touches them.
        CREATE TABLE document_files (
          document_id bigint PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
          data bytea NOT NULL,
          CONSTRAINT document_files_size CHECK (octet_length(data) BETWEEN 1 AND 52428800)
        );

        GRANT SELECT, INSERT, UPDATE, DELETE ON document_categories, documents, document_files TO kmk_app;
        """
    )
    op.execute(SEED_SQL)


def downgrade() -> None:
    op.execute("DROP TABLE document_files; DROP TABLE documents; DROP TABLE document_categories;")
