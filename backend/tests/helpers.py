import os

from sqlalchemy import text

from app.config import Settings

ORIGIN = {"Origin": "http://testserver"}
PW = "Abcdef1!"


def make_settings(**kw) -> Settings:
    base = dict(
        database_url=os.environ["DATABASE_URL"],
        session_secret="test-secret",
        cookie_secure=False,
        allowed_origins=["http://testserver"],
        rl_ip_max=6,
        rl_identifier_max=3,
    )
    base.update(kw)
    return Settings(**base)


def login(client, identifier="alice", password=PW, headers=ORIGIN):
    return client.post("/api/auth/login", json={"identifier": identifier, "password": password}, headers=headers)


def sql(engine, query, **params):
    with engine.begin() as c:
        result = c.execute(text(query), params)
        return result.fetchall() if result.returns_rows else []
