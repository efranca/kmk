#!/usr/bin/env python3
"""Permanently delete one user and everything that points at them.

    cd backend
    .venv/bin/python scripts/delete_user.py USERNAME_OR_EMAIL            # dry run: shows what would happen
    .venv/bin/python scripts/delete_user.py USERNAME_OR_EMAIL --yes      # does it, in one transaction

Runs as the database OWNER role (MIGRATION_DATABASE_URL from backend/.env or the environment),
because the runtime role cannot touch the audit log.

How each reference to users.id is handled (found from the database catalog, so new tables are covered):
  * ON DELETE CASCADE                      -> removed with the user (event people, task people, push devices...)
  * nullable column (created_by, ...)      -> set to NULL
  * NOT NULL, in PURGE_TABLES              -> rows deleted (sessions, tokens, recovery codes)
  * NOT NULL, anything else (documents...) -> refused, unless --reassign-to ID moves them to another user
  * audit_log / login_attempts             -> kept (security record) unless --purge-audit

The super admin is never deleted. Nothing is printed that is secret (no hashes, tokens or MFA data).
"""
import argparse
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

PURGE_TABLES = {"sessions", "tokens", "recovery_codes"}

REFS_SQL = text("""
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, a.attnotnull AS notnull, c.confdeltype AS ondelete
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.users'::regclass AND array_length(c.conkey, 1) = 1
    ORDER BY 1, 2
""")


def database_url() -> str:
    url = os.environ.get("MIGRATION_DATABASE_URL") or os.environ.get("DATABASE_URL")
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not url and env_file.exists():
        values = {}
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip().strip("'\"")
        url = values.get("MIGRATION_DATABASE_URL") or values.get("DATABASE_URL")
    if not url:
        raise SystemExit("MIGRATION_DATABASE_URL is not set (environment or backend/.env).")
    return url


def q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("who", help="username, email or numeric id")
    ap.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    ap.add_argument("--reassign-to", type=int, metavar="ID", help="give NOT NULL ownership (e.g. documents) to this user")
    ap.add_argument("--purge-audit", action="store_true", help="also delete audit_log and login_attempts rows about the user")
    args = ap.parse_args()

    engine = create_engine(database_url(), connect_args={"connect_timeout": 5})
    with engine.begin() as db:
        who = args.who.strip().lower()
        row = db.execute(
            text("SELECT id, username, email, role, status FROM users WHERE username = :w OR email = :w OR id::text = :w"),
            {"w": who},
        ).first()
        if not row:
            print("No such user.", file=sys.stderr)
            return 1
        uid, username, email, role, status = row
        print(f"User #{uid}: {username} <{email}> role={role} status={status}")
        if role == "superadmin":
            print("Refusing: the super admin cannot be deleted.", file=sys.stderr)
            return 1
        if args.reassign_to is not None:
            if args.reassign_to == uid or not db.scalar(text("SELECT 1 FROM users WHERE id = :i"), {"i": args.reassign_to}):
                print("--reassign-to must be a different, existing user.", file=sys.stderr)
                return 1

        plan, blocked = [], []
        for tbl, col, notnull, ondelete in db.execute(REFS_SQL):
            n = db.scalar(text(f"SELECT count(*) FROM {tbl} WHERE {q(col)} = :u"), {"u": uid})
            if not n:
                continue
            if ondelete == "c":
                plan.append((f"{tbl}.{col}", n, "deleted with the user (cascade)", None))
            elif not notnull:
                plan.append((f"{tbl}.{col}", n, "set to NULL", f"UPDATE {tbl} SET {q(col)} = NULL WHERE {q(col)} = :u"))
            elif tbl in PURGE_TABLES:
                plan.append((f"{tbl}.{col}", n, "rows deleted", f"DELETE FROM {tbl} WHERE {q(col)} = :u"))
            elif args.reassign_to is not None:
                plan.append((f"{tbl}.{col}", n, f"reassigned to user #{args.reassign_to}",
                             f"UPDATE {tbl} SET {q(col)} = :r WHERE {q(col)} = :u"))
            else:
                blocked.append((f"{tbl}.{col}", n))

        audit = db.scalar(text("SELECT count(*) FROM audit_log WHERE actor_user_id = :u OR target_user_id = :u"), {"u": uid})
        attempts = db.scalar(text("SELECT count(*) FROM login_attempts WHERE identifier IN (:a, :b)"), {"a": username, "b": email})
        if args.purge_audit:
            plan.append(("audit_log", audit, "rows deleted", "DELETE FROM audit_log WHERE actor_user_id = :u OR target_user_id = :u"))
            plan.append(("login_attempts", attempts, "rows deleted", None))
        else:
            print(f"  (kept: {audit} audit_log rows, {attempts} login_attempts rows; use --purge-audit to remove)")

        for target, n, what, _ in plan:
            print(f"  {target}: {n} -> {what}")
        if blocked:
            for target, n in blocked:
                print(f"  {target}: {n} -> BLOCKED (NOT NULL, needs --reassign-to)", file=sys.stderr)
            return 1
        if not args.yes:
            print("Dry run: nothing changed. Add --yes to delete.")
            return 0

        params = {"u": uid, "r": args.reassign_to}
        for _, _, _, sql in plan:
            if sql:
                db.execute(text(sql), {k: v for k, v in params.items() if f":{k}" in sql})
        if args.purge_audit:
            db.execute(text("DELETE FROM login_attempts WHERE identifier IN (:a, :b)"), {"a": username, "b": email})
        db.execute(text("DELETE FROM users WHERE id = :u"), {"u": uid})
        print(f"Deleted user #{uid}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
