import argparse
import getpass
import sys

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import names
from app.auth import audit
from app.config import get_settings
from app.db import make_engine
from app.models import User
from app.security import hash_password, validate_password_rules


def read_password() -> str:
    """Hidden prompt on a terminal; one line from stdin otherwise (scripts). Never from argv."""
    if sys.stdin.isatty():
        first = getpass.getpass("Password: ")
        if getpass.getpass("Repeat password: ") != first:
            raise SystemExit("Passwords do not match.")
        return first
    return sys.stdin.readline().rstrip("\n")


def _clean_name_or_report(raw: str) -> str | None:
    """The cleaned name, or None after printing why it is refused (the reason never echoes the input)."""
    try:
        return names.clean_name(raw)
    except ValueError as exc:
        print(f"Invalid name: {exc}.", file=sys.stderr)
        return None


def create_superadmin(username: str, email: str, locale: str, name: str) -> int:
    clean = _clean_name_or_report(name)
    if clean is None:
        return 1
    password = read_password()
    problems = validate_password_rules(password)
    if problems:
        print("Password refused: " + ", ".join(problems), file=sys.stderr)
        return 1
    engine = make_engine(get_settings().database_url)
    with Session(engine) as db:
        if db.scalar(select(User.id).where(User.role == "superadmin")):
            print("A super admin already exists.", file=sys.stderr)
            return 1
        user = User(
            username=username.strip().lower(),
            email=email.strip().lower(),
            password_hash=hash_password(password),
            name=clean,
            role="superadmin",
            locale=locale,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            print("Username or email already in use.", file=sys.stderr)
            return 1
        audit.log(db, "user_created", target_user_id=user.id, details={"role": "superadmin", "via": "cli"})
        db.commit()
    print(f"Super admin '{username.strip().lower()}' created.")
    return 0


def set_name(username: str, name: str) -> int:
    """Set or change anyone's name (handy before the first sign-in; the audit row records the field, never the value)."""
    clean = _clean_name_or_report(name)
    if clean is None:
        return 1
    engine = make_engine(get_settings().database_url)
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.username == username.strip().lower()))
        if user is None:
            print("No such user.", file=sys.stderr)
            return 1
        if user.name == clean:
            print("The name was already set: nothing to change.")
            return 0
        user.name = clean
        audit.log(db, "user_updated", target_user_id=user.id, details={"fields": ["name"], "via": "cli"})
        db.commit()
    print(f"Name set for '{username.strip().lower()}'.")
    return 0


def reset_mfa(username: str) -> int:
    """Escape hatch for a lost phone: removes the user's TOTP, recovery codes and sessions."""
    engine = make_engine(get_settings().database_url)
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.username == username.strip().lower()))
        if user is None:
            print("No such user.", file=sys.stderr)
            return 1
        user.mfa_enabled = False
        user.mfa_secret = None
        user.mfa_last_step = None
        db.execute(text("DELETE FROM recovery_codes WHERE user_id = :u"), {"u": user.id})
        db.execute(text("UPDATE sessions SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL"), {"u": user.id})
        audit.log(db, "mfa_reset", target_user_id=user.id, details={"via": "cli"})
        db.commit()
    print(f"Two-step verification reset for '{username.strip().lower()}'. Their sessions were signed out.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-superadmin")
    p.add_argument("--username", required=True)
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True, help="the person's name, for example \"Marie Tremblay\"")
    p.add_argument("--locale", default="fr-CA", choices=["fr-CA", "en", "pt-BR"])
    n = sub.add_parser("set-name", help="set or change a person's name")
    n.add_argument("--username", required=True)
    n.add_argument("--name", required=True)
    r = sub.add_parser("reset-mfa", help="remove a user's two-step verification (lost phone)")
    r.add_argument("--username", required=True)
    args = parser.parse_args(argv)
    if args.command == "reset-mfa":
        return reset_mfa(args.username)
    if args.command == "set-name":
        return set_name(args.username, args.name)
    return create_superadmin(args.username, args.email, args.locale, args.name)


if __name__ == "__main__":
    raise SystemExit(main())
