from sqlalchemy import Engine, create_engine


def make_engine(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 3})
