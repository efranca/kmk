from dataclasses import dataclass
from html import escape

from app.config import Settings


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str
    html: str
    sender: str | None = None  # the From; None = the application's EMAIL_FROM
    reply_to: str | None = None
    attachments: tuple[tuple[str, bytes], ...] = ()  # (file name, bytes)


# Greeting per locale: with a name, and without one.
_GREETING = {
    "fr-CA": ("Bonjour {name},", "Bonjour,"),
    "en": ("Hello {name},", "Hello,"),
    "pt-BR": ("Olá {name},", "Olá,"),
    "es": ("Hola {name},", "Hola,"),
}

# The text of the link in the HTML part (the long address with its token stays behind it): per locale, invite then reset.
_LINK_TEXT = {
    "fr-CA": ("Choisir mon mot de passe", "Choisir un nouveau mot de passe"),
    "en": ("Choose my password", "Choose a new password"),
    "pt-BR": ("Escolher minha senha", "Escolher uma nova senha"),
    "es": ("Elegir mi contraseña", "Elegir una nueva contraseña"),
}

SITE = "app.kmk-entretien.ca"

# Per locale and kind: subject, greeting+intro (before the link), expiry words, ignore line.
_T = {
    "fr-CA": {
        "invite": (
            "Invitation à KMK Entretien Ménager",
            "Un compte a été créé pour vous sur app.kmk-entretien.ca. Pour choisir votre mot de passe, ouvrez ce lien :",
            "Ce lien est valide 48 heures et ne peut être utilisé qu'une seule fois.",
        ),
        "reset": (
            "Réinitialisation de votre mot de passe",
            "Une réinitialisation du mot de passe de votre compte KMK Entretien Ménager a été demandée. Pour choisir un nouveau mot de passe, ouvrez ce lien :",
            "Ce lien est valide 30 minutes et ne peut être utilisé qu'une seule fois.",
        ),
        "ignore": "Si vous n'attendiez pas ce courriel, ignorez-le : rien ne changera.",
    },
    "en": {
        "invite": (
            "You're invited to KMK Entretien Ménager",
            "An account has been created for you on app.kmk-entretien.ca. To choose your password, open this link:",
            "This link is valid for 48 hours and can only be used once.",
        ),
        "reset": (
            "Reset your password",
            "A password reset was requested for your KMK Entretien Ménager account. To choose a new password, open this link:",
            "This link is valid for 30 minutes and can only be used once.",
        ),
        "ignore": "If you did not expect this email, ignore it: nothing will change.",
    },
    "pt-BR": {
        "invite": (
            "Convite para a KMK Entretien Ménager",
            "Uma conta foi criada para você em app.kmk-entretien.ca. Para escolher sua senha, abra este link:",
            "Este link é válido por 48 horas e só pode ser usado uma vez.",
        ),
        "reset": (
            "Redefinição de senha",
            "Foi solicitada a redefinição da senha da sua conta KMK Entretien Ménager. Para escolher uma nova senha, abra este link:",
            "Este link é válido por 30 minutos e só pode ser usado uma vez.",
        ),
        "ignore": "Se você não esperava este e-mail, ignore-o: nada será alterado.",
    },
    "es": {
        "invite": (
            "Invitación a KMK Entretien Ménager",
            "Se creó una cuenta para ti en app.kmk-entretien.ca. Para elegir tu contraseña, abre este enlace:",
            "Este enlace es válido por 48 horas y solo se puede usar una vez.",
        ),
        "reset": (
            "Restablecer tu contraseña",
            "Se solicitó restablecer la contraseña de tu cuenta de KMK Entretien Ménager. Para elegir una nueva contraseña, abre este enlace:",
            "Este enlace es válido por 30 minutos y solo se puede usar una vez.",
        ),
        "ignore": "Si no esperabas este correo, ignóralo: nada cambiará.",
    },
}


def render(kind: str, locale: str, link: str, to: str, name: str | None = None) -> EmailMessage:
    locale = locale if locale in _T else "fr-CA"
    t = _T[locale]
    subject, intro, expiry = t[kind]
    ignore = t["ignore"]
    with_name, without = _GREETING[locale]
    # The name goes only into the body (never the subject or a header); the HTML part escapes it.
    greeting = with_name.format(name=name) if name else without
    # Plain text cannot hide an address behind words, so it keeps the full link. The HTML part shows words instead.
    text = f"{greeting}\n\n{intro}\n\n{link}\n\n{expiry}\n{ignore}\n\nKMK Entretien"
    site = f"https://{SITE}"
    intro_html = escape(intro).replace(SITE, f'<a href="{site}" style="color:#007A78">{SITE}</a>', 1)
    label = _LINK_TEXT[locale][0 if kind == "invite" else 1]
    html = (
        '<div style="font-family:Inter,Arial,sans-serif;color:#16242C;max-width:520px">'
        '<h2 style="color:#007A78;margin:0 0 16px">KMK Entretien Ménager</h2>'
        f"<p>{escape(greeting)}</p><p>{intro_html}</p>"
        f'<p><a href="{escape(link)}" style="color:#007A78;font-weight:600">{escape(label)}</a></p>'
        f"<p>{escape(expiry)}</p>"
        f'<p style="color:#49575F;font-size:14px">{escape(ignore)}</p>'
        '<p style="color:#49575F;font-size:12px;margin-top:24px">KMK Entretien</p>'
        "</div>"
    )
    return EmailMessage(to=to, subject=subject, text=text, html=html)


def build_link(settings: Settings, raw_token: str, locale: str | None = None) -> str:
    # The token is in the URL fragment: browsers never send it to the server, so it stays out of logs and Referer headers.
    # The language (not secret) rides along so the set-password page opens in the recipient's language.
    link = f"{settings.public_base_url.rstrip('/')}/set-password#token={raw_token}"
    return f"{link}&lang={locale}" if locale else link
