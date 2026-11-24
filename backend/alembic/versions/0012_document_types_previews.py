"""more document file types, and previews for the tiles view

Revision ID: 0012
Revises: 0011
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

TYPES = (
    "application/pdf",
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/bmp", "image/heic", "image/tiff",
    "text/plain", "text/markdown", "text/csv", "text/tab-separated-values", "application/json", "application/rtf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
)
OLD_TYPES = ("application/pdf", "image/jpeg", "image/png", "image/webp")


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    op.execute(
        f"""
        ALTER TABLE documents DROP CONSTRAINT documents_content_type;
        ALTER TABLE documents ADD CONSTRAINT documents_content_type CHECK (content_type IS NULL OR content_type IN ({_in(TYPES)}));

        -- A small JPEG the browser makes for the tiles view (at most 100 KB; the server checks the type and size again).
        CREATE TABLE document_previews (
          document_id bigint PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
          data bytea NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT document_previews_size CHECK (octet_length(data) BETWEEN 1 AND 102400)
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON document_previews TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DROP TABLE document_previews;
        DELETE FROM document_files WHERE document_id IN (SELECT id FROM documents WHERE content_type NOT IN ({_in(OLD_TYPES)}));
        UPDATE documents SET content_type = NULL, file_name = NULL, size_bytes = NULL
          WHERE content_type NOT IN ({_in(OLD_TYPES)});
        ALTER TABLE documents DROP CONSTRAINT documents_content_type;
        ALTER TABLE documents ADD CONSTRAINT documents_content_type CHECK (content_type IS NULL OR content_type IN ({_in(OLD_TYPES)}));
        """
    )
