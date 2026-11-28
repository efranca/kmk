import pytest

from test_clients_api import add
from test_schedule_api import session


@pytest.fixture
def boss(make_client, add_user):
    return session(make_client, add_user, "boss", role="admin")


@pytest.fixture
def staff(make_client, add_user):
    return session(make_client, add_user, "zoe")


def test_staff_cannot_bill(boss, staff):
    c, h = boss
    cid = add(c, h).json()["client"]["id"]
    s, _ = staff
    r = s.get(f"/api/clients/{cid}/billable", params={"from": "2025-11-01", "to": "2025-11-30"})
    assert (r.status_code, r.json()) == (403, {"error": "forbidden"})
