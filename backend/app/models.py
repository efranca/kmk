import uuid
from datetime import date, datetime, time

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Identity, Integer, LargeBinary, String, Text, Time, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("username = lower(username)", name="users_username_lower"),
        CheckConstraint("email = lower(email)", name="users_email_lower"),
        CheckConstraint("role in ('user','admin','superadmin')", name="users_role_valid"),
        CheckConstraint("locale in ('fr-CA','en','pt-BR')", name="users_locale_valid"),
        CheckConstraint("status in ('invited','active','disabled','deleted')", name="users_status_valid"),
        CheckConstraint("name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 100", name="users_name_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    username: Mapped[str] = mapped_column(Text, unique=True)
    email: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)  # display name; people without one show their username
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(Text, default="user")
    locale: Mapped[str] = mapped_column(Text, default="fr-CA")
    status: Mapped[str] = mapped_column(Text, default="active")
    mfa_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_last_step: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    preferences: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    settings: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")  # admin-managed, see app/user_settings.py


class UserSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_verified: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Public handle for the devices page (the token hash is never exposed) and last access, written at most every 5 minutes.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, server_default=text("gen_random_uuid()"))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    action: Mapped[str] = mapped_column(Text)
    target_user_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip: Mapped[str] = mapped_column(Text)
    identifier: Mapped[str] = mapped_column(Text)
    success: Mapped[bool] = mapped_column(Boolean)
    kind: Mapped[str] = mapped_column(Text, default="login", server_default="login")


class CalendarFeed(Base):
    """A user's personal .ics feed (one per user). Only the token's hash is stored."""

    __tablename__ = "calendar_feeds"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Token(Base):
    __tablename__ = "tokens"
    __table_args__ = (CheckConstraint("purpose in ('invite','reset')", name="tokens_purpose_valid"),)

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    purpose: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RecoveryCode(Base):
    __tablename__ = "recovery_codes"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Event(Base):
    """One event or repeating series. Dates and times are wall-clock values in the company time zone."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(Text, nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    start_date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recurrence: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True), nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    max_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)  # NULL = made by the website
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EventPerson(Base):
    """A person an event is for (an event with no rows is for everyone)."""

    __tablename__ = "event_people"

    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class EventException(Base):
    """A "this occurrence only" change: cancelled, or some fields overridden (null keeps the series' value)."""

    __tablename__ = "event_exceptions"

    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    original_date: Mapped[date] = mapped_column(Date, primary_key=True)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)


class EventReminder(Base):
    __tablename__ = "event_reminders"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    unit: Mapped[str] = mapped_column(Text)


class ReminderDismissal(Base):
    __tablename__ = "reminder_dismissals"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    occurrence_date: Mapped[date] = mapped_column(Date, primary_key=True)
    dismissed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskCategory(Base):
    """A label for tasks: a name (unique ignoring case) and an optional emoji."""

    __tablename__ = "task_categories"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)  # NULL for the seeded starters
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Client(Base):
    """Someone the company works for. Tasks, events, documents and quotes can point to one (`client_id`)."""

    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, default="other")
    contact_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)  # admins only
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Task(Base):
    """One task: to do or completed, with an optional due date (wall-clock date in the company time zone)."""

    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("task_categories.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(Text, default="pending")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    show_on_dashboard: Mapped[bool] = mapped_column(Boolean, default=True)
    client_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)  # NULL = made by the website
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskPerson(Base):
    """A person a task is for (a task with no rows is for the whole team)."""

    __tablename__ = "task_people"

    task_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class UserAvatar(Base):
    """A profile picture (at most 50 KB, JPEG, PNG or WebP); `users.avatar_updated_at` says whether there is one."""

    __tablename__ = "user_avatars"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    content_type: Mapped[str] = mapped_column(Text)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentCategory(Base):
    """A label for documents: a name (unique ignoring case) and an optional emoji."""

    __tablename__ = "document_categories"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)  # NULL for the seeded starters
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Document(Base):
    """A company document's metadata. `size_bytes` NULL means the upload is pending (no file yet): see document_files."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("document_categories.id", ondelete="SET NULL"), nullable=True)
    visibility: Mapped[str] = mapped_column(Text, default="admins", server_default="admins")  # everyone | admins | superadmin
    file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    client_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentFile(Base):
    """The bytes of a document, in a table of their own so lists never read them."""

    __tablename__ = "document_files"

    document_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class DocumentPreview(Base):
    """A small JPEG the browser makes for the tiles view."""

    __tablename__ = "document_previews"

    document_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Quote(Base):
    """A quote request from the public form. `draft` until the customer presses Send."""

    __tablename__ = "quotes"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    status: Mapped[str] = mapped_column(Text, default="draft")
    kind: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str] = mapped_column(Text)
    ip_key: Mapped[str] = mapped_column(Text)
    geo_country: Mapped[str | None] = mapped_column(Text, nullable=True)
    geo_city: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_hash: Mapped[str] = mapped_column(Text)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    task_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    event_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    client_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def reference(self) -> str:
        return f"D-{self.id:04d}"


class QuotePhoto(Base):
    __tablename__ = "quote_photos"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    quote_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("quotes.id", ondelete="CASCADE"), index=True)
    content_type: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class QuoteMessage(Base):
    """One message of the conversation: `out` is emailed from the app, `in` is a customer reply pasted by an admin."""

    __tablename__ = "quote_messages"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    quote_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("quotes.id", ondelete="CASCADE"), index=True)
    direction: Mapped[str] = mapped_column(Text)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    body: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delivery: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AppSetting(Base):
    """Company-wide settings edited by the super admin (quote sender, Reply-To, notification email, phone)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PushSubscription(Base):
    """One device of one admin that turned notifications on."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
