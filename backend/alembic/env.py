from alembic import context
from sqlalchemy import create_engine

from app.config import get_settings

target_metadata = None


def run_migrations_online() -> None:
    engine = create_engine(get_settings().migration_database_url or get_settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
