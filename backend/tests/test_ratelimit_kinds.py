from sqlalchemy.orm import Session

from app.auth import ratelimit
from helpers import make_settings


def fail(engine, ip, identifier, kind=None, n=1):
    with Session(engine) as db:
        for _ in range(n):
            if kind is None:
                ratelimit.record_attempt(db, ip, identifier, False)
            else:
                ratelimit.record_attempt(db, ip, identifier, False, kind=kind)
        db.commit()


def limited(engine, ip, identifier, kind):
    with Session(engine) as db:
        return ratelimit.is_limited(db, ip, identifier, make_settings(rl_identifier_max=2, rl_ip_max=2), kind=kind)


def test_identifier_failures_are_counted_per_kind(owner_engine, app_engine):
    fail(app_engine, "1.1.1.1", "a", n=2)  # default kind is "login"
    assert limited(app_engine, "9.9.9.9", "a", "login") is True
    assert limited(app_engine, "9.9.9.9", "a", "reset_request") is False


def test_ip_failures_are_counted_per_kind(owner_engine, app_engine):
    fail(app_engine, "2.2.2.2", "x", kind="reset_request")
    fail(app_engine, "2.2.2.2", "y", kind="reset_request")
    assert limited(app_engine, "2.2.2.2", "z", "reset_request") is True
    assert limited(app_engine, "2.2.2.2", "z", "login") is False
    assert limited(app_engine, "2.2.2.2", "z", "token") is False


# ---- review F5: an IPv6 /64 is one source, not 2^64 ----

def test_ip_key_groups_ipv6_by_the_64_bit_prefix():
    assert ratelimit.ip_key("2001:db8:1:2:aaaa:bbbb:cccc:dddd") == "2001:db8:1:2::/64"
    assert ratelimit.ip_key("2001:db8:1:2::1") == ratelimit.ip_key("2001:db8:1:2:ffff:ffff:ffff:ffff")
    assert ratelimit.ip_key("2001:db8:1:3::1") != ratelimit.ip_key("2001:db8:1:2::1")


def test_ip_key_leaves_ipv4_and_unknown_values_alone():
    assert ratelimit.ip_key("203.0.113.9") == "203.0.113.9"
    assert ratelimit.ip_key("::ffff:203.0.113.9") == "203.0.113.9"  # an IPv4 address in IPv6 clothing
    assert ratelimit.ip_key("testclient") == "testclient"


def test_addresses_in_one_ipv6_prefix_share_the_address_limit(make_client):
    from helpers import login

    a = make_client(peer="2001:db8:5:5::1")
    b = make_client(peer="2001:db8:5:5:dead:beef:0:2")  # a different address, same /64
    for i in range(3):
        assert login(a, f"nobody-a{i}", "x").status_code == 401
        assert login(b, f"nobody-b{i}", "x").status_code == 401
    assert login(a, "nobody-a9", "x").status_code == 429  # rl_ip_max = 6 reached across both addresses
    assert login(b, "nobody-b9", "x").status_code == 429
    other = make_client(peer="2001:db8:6:6::1")  # another /64 is unaffected
    assert login(other, "nobody-c", "x").status_code == 401
