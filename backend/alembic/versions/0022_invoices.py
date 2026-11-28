"""invoices: numbered invoices built from Agenda occurrences, and the price per visit on properties

Revision ID: 0022
Revises: 0021
"""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE properties ADD COLUMN visit_price numeric(10,2)
          CHECK (visit_price IS NULL OR visit_price BETWEEN 0 AND 99999.99);

        CREATE TABLE invoices (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          number integer NOT NULL UNIQUE CHECK (number > 0),
          client_id bigint REFERENCES clients(id) ON DELETE SET NULL,
          bill_name text NOT NULL, bill_address text, bill_city text, bill_phone text, bill_email text,
          issued_on date NOT NULL,
          status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
          paid_on date,
          subtotal numeric(10,2) NOT NULL CHECK (subtotal >= 0),
          tax numeric(10,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
          extra numeric(10,2) NOT NULL DEFAULT 0 CHECK (extra >= 0),
          total numeric(10,2) NOT NULL CHECK (total >= 0),
          sent_at timestamptz, cancelled_at timestamptz,
          document_id bigint REFERENCES documents(id) ON DELETE SET NULL,
          created_by bigint REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
          updated_by bigint REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT invoices_paid_has_date CHECK ((status = 'paid') = (paid_on IS NOT NULL))
        );
        CREATE INDEX invoices_client_idx ON invoices (client_id);

        CREATE TABLE invoice_lines (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          invoice_id bigint NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          position integer NOT NULL,
          description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),
          amount numeric(10,2) NOT NULL CHECK (amount BETWEEN 0 AND 99999.99),
          event_id bigint REFERENCES events(id) ON DELETE SET NULL,
          occurrence_date date,
          live boolean NOT NULL DEFAULT true,
          CONSTRAINT invoice_lines_event_has_date CHECK (event_id IS NULL OR occurrence_date IS NOT NULL)
        );
        CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);
        CREATE UNIQUE INDEX invoice_lines_once ON invoice_lines (event_id, occurrence_date)
          WHERE live AND event_id IS NOT NULL;
        GRANT SELECT, INSERT, UPDATE, DELETE ON invoices, invoice_lines TO kmk_app;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE invoice_lines;
        DROP TABLE invoices;
        ALTER TABLE properties DROP COLUMN visit_price;
        """
    )
