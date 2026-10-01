"""Business-scoped public registration and Google identity persistence.

Existing inventory and forecast operations remain in Repository. Public signups
reserve an email across businesses without changing historical email constraints.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from .repository import Repository
from .security import Principal, hash_password, new_token, token_hash, verify_password


class AuthRepository(Repository):
    def _lock(self, resource: str) -> None:
        self.conn.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (resource,)
        )

    def sign_in(
        self, business_id: UUID | None, email: str, password: str, hours: int
    ) -> tuple[str, str, Principal]:
        normalized_email = email.strip().lower()
        if business_id is None:
            rows = self.conn.execute(
                """SELECT u.* FROM users u JOIN businesses b ON b.id=u.business_id
                   WHERE u.email=%s AND u.is_active AND b.is_active""",
                (normalized_email,),
            ).fetchall()
        else:
            rows = self.conn.execute(
                """SELECT u.* FROM users u JOIN businesses b ON b.id=u.business_id
                   WHERE u.business_id=%s AND u.email=%s AND u.is_active AND b.is_active""",
                (business_id, normalized_email),
            ).fetchall()
        matching = [
            row for row in rows
            if row["password_hash"] and verify_password(password, row["password_hash"])
        ]
        if not matching:
            raise HTTPException(401, "Invalid business, email, or password")
        if len(matching) > 1:
            raise HTTPException(409, "Enter your Business ID to select your store")
        return self.issue_session(self._principal(matching[0]), hours)

    def authenticate(self, session: str) -> tuple[Principal, str]:
        row = self.conn.execute(
            """UPDATE sessions s SET last_seen_at=now() FROM users u, businesses b
               WHERE s.token_hash=%s AND s.expires_at>now() AND u.id=s.user_id
                 AND u.is_active AND b.id=u.business_id AND b.is_active
               RETURNING u.id,u.business_id,u.email,u.display_name,u.role,s.csrf_token_hash""",
            (token_hash(session),),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Sign in is required")
        return self._principal(row), row["csrf_token_hash"]

    def valid_session(self, session_hash: str | None) -> Principal | None:
        if not session_hash:
            return None
        row = self.conn.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
               JOIN businesses b ON b.id=u.business_id
               WHERE s.token_hash=%s AND s.expires_at>now() AND u.is_active AND b.is_active""",
            (session_hash,),
        ).fetchone()
        return self._principal(row) if row else None

    def issue_session(self, user: Principal, hours: int) -> tuple[str, str, Principal]:
        # Recheck membership before creating a session, including after OAuth.
        row = self.conn.execute(
            """SELECT u.* FROM users u JOIN businesses b ON b.id=u.business_id
               WHERE u.id=%s AND u.business_id=%s AND u.is_active AND b.is_active""",
            (user.user_id, user.business_id),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Sign in is required")
        session, csrf = new_token(), new_token()
        expires = datetime.now(UTC) + timedelta(hours=hours)
        self.conn.execute(
            """INSERT INTO sessions(user_id,token_hash,csrf_token_hash,expires_at)
               VALUES(%s,%s,%s,%s)""",
            (row["id"], token_hash(session), token_hash(csrf), expires),
        )
        return session, csrf, self._principal(row)

    def email_exists(self, email: str) -> bool:
        return self.conn.execute(
            "SELECT id FROM users WHERE email=%s LIMIT 1", (email.strip().lower(),)
        ).fetchone() is not None

    def create_account(
        self,
        email: str,
        display_name: str,
        business_name: str,
        location: str | None,
        data_origin: str,
        password: str | None,
        hours: int,
        google_subject: str | None = None,
    ) -> tuple[str, str, Principal]:
        normalized_email = email.strip().lower()
        name = display_name.strip()
        store_name = business_name.strip()
        if not normalized_email or not name or not store_name:
            raise HTTPException(422, "Email, your name, and store name are required")
        if data_origin not in {"demo", "partner"}:
            raise HTTPException(422, "Choose demo or partner data provenance")
        if password is None and not google_subject:
            raise HTTPException(422, "A password or verified Google identity is required")
        if password is not None and not 12 <= len(password) <= 128:
            raise HTTPException(422, "Password must contain 12 to 128 characters")
        password_hash = hash_password(password) if password is not None else None
        changed_at = datetime.now(UTC) if password_hash else None
        with self.conn.transaction():
            # The SQL history allows an email in multiple businesses. Registration
            # is intentionally stricter without rewriting those existing records.
            self._lock("stockcast:signup-email:" + normalized_email)
            existing = self.conn.execute(
                "SELECT id FROM users WHERE email=%s LIMIT 1", (normalized_email,)
            ).fetchone()
            if existing:
                raise HTTPException(409, "An account with this email exists. Sign in instead.")
            business = self.conn.execute(
                """INSERT INTO businesses(name,location,data_origin)
                   VALUES(%s,%s,%s) RETURNING id""",
                (store_name, location.strip() if location else None, data_origin),
            ).fetchone()
            self.conn.execute(
                "INSERT INTO business_settings(business_id) VALUES(%s)", (business["id"],)
            )
            row = self.conn.execute(
                """INSERT INTO users
                   (business_id,email,display_name,role,password_hash,password_changed_at)
                   VALUES(%s,%s,%s,'owner',%s,%s)
                   RETURNING *""",
                (business["id"], normalized_email, name, password_hash, changed_at),
            ).fetchone()
            if google_subject:
                self.link_identity(google_subject, str(row["id"]))
            return self.issue_session(self._principal(row), hours)

    def google_user(self, subject: str) -> Principal | None:
        row = self.conn.execute(
            """SELECT u.*,b.is_active AS business_active FROM google_identities g
               JOIN users u ON u.id=g.user_id JOIN businesses b ON b.id=u.business_id
               WHERE g.subject=%s""",
            (subject,),
        ).fetchone()
        if row and (not row["is_active"] or not row["business_active"]):
            raise HTTPException(401, "This account is unavailable")
        return self._principal(row) if row else None

    def link_identity(self, subject: str, user_id: str) -> None:
        with self.conn.transaction():
            self._lock("stockcast:google-subject:" + subject)
            self._lock("stockcast:google-user:" + user_id)
            row = self.conn.execute(
                """SELECT u.id FROM users u JOIN businesses b ON b.id=u.business_id
                   WHERE u.id=%s AND u.is_active AND b.is_active""",
                (user_id,),
            ).fetchone()
            if not row:
                raise HTTPException(401, "This account is unavailable")
            identity = self.conn.execute(
                "SELECT user_id FROM google_identities WHERE subject=%s", (subject,)
            ).fetchone()
            if identity:
                if str(identity["user_id"]) != user_id:
                    raise HTTPException(409, "This Google account is linked to another account")
                return
            linked = self.conn.execute(
                "SELECT subject FROM google_identities WHERE user_id=%s", (user_id,)
            ).fetchone()
            if linked:
                raise HTTPException(409, "This account already has a linked Google account")
            self.conn.execute(
                "INSERT INTO google_identities(subject,user_id) VALUES(%s,%s)",
                (subject, user_id),
            )

    def create_flow(
        self,
        state_hash: str,
        browser_hash: str,
        verifier: str,
        nonce: str,
        intent: str,
        session_hash: str | None = None,
    ) -> None:
        if intent not in {"sign-in", "link"}:
            raise HTTPException(422, "Unsupported Google sign-in intent")
        if (intent == "link") != bool(session_hash):
            raise HTTPException(422, "Google linking requires the initiating session")
        self.conn.execute("DELETE FROM oauth_flows WHERE expires_at<=now()")
        self.conn.execute(
            """INSERT INTO oauth_flows
               (state_hash,browser_hash,verifier,nonce,intent,session_hash,expires_at)
               VALUES(%s,%s,%s,%s,%s,%s,now()+interval '10 minutes')""",
            (state_hash, browser_hash, verifier, nonce, intent, session_hash),
        )

    def consume_flow(self, state_hash: str, browser_hash: str) -> dict[str, Any] | None:
        # The caller must commit before token exchange if a later callback error
        # should consume the state permanently instead of rolling it back.
        return self.conn.execute(
            """DELETE FROM oauth_flows
               WHERE state_hash=%s AND browser_hash=%s AND expires_at>now() RETURNING *""",
            (state_hash, browser_hash),
        ).fetchone()

    def create_pending(
        self, token_hash: str, subject: str, email: str, display_name: str
    ) -> None:
        self.conn.execute("DELETE FROM google_pending WHERE expires_at<=now()")
        self.conn.execute(
            """INSERT INTO google_pending(token_hash,subject,email,display_name,expires_at)
               VALUES(%s,%s,%s,%s,now()+interval '10 minutes')""",
            (token_hash, subject, email.strip().lower(), display_name.strip()),
        )

    def pending(self, token_hash: str) -> dict[str, Any] | None:
        return self.conn.execute(
            "SELECT * FROM google_pending WHERE token_hash=%s AND expires_at>now()",
            (token_hash,),
        ).fetchone()

    def complete_pending(
        self,
        token_hash: str,
        business_name: str,
        location: str | None,
        origin: str,
        hours: int,
    ) -> tuple[str, str, Principal]:
        with self.conn.transaction():
            pending = self.conn.execute(
                """DELETE FROM google_pending
                   WHERE token_hash=%s AND expires_at>now() RETURNING *""",
                (token_hash,),
            ).fetchone()
            if not pending:
                raise HTTPException(401, "Google registration expired. Sign in with Google again.")
            return self.create_account(
                email=pending["email"],
                display_name=pending["display_name"],
                business_name=business_name,
                location=location,
                data_origin=origin,
                password=None,
                hours=hours,
                google_subject=pending["subject"],
            )
