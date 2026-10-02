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
        self.conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (resource,))

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
            row
            for row in rows
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
        return (
            self.conn.execute(
                "SELECT id FROM users WHERE email=%s LIMIT 1", (email.strip().lower(),)
            ).fetchone()
            is not None
        )

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

    def change_password(self, user: Principal, current: str, replacement: str) -> None:
        if not 12 <= len(replacement) <= 128:
            raise HTTPException(422, "Password must contain 12 to 128 characters")
        row = self.conn.execute(
            "SELECT password_hash FROM users WHERE id=%s AND business_id=%s FOR UPDATE",
            (user.user_id, user.business_id),
        ).fetchone()
        if (
            not row
            or not row["password_hash"]
            or not verify_password(current, row["password_hash"])
        ):
            raise HTTPException(401, "Current password is incorrect")
        self.conn.execute(
            "UPDATE users SET password_hash=%s,password_changed_at=now() WHERE id=%s",
            (hash_password(replacement), user.user_id),
        )
        self.conn.execute("DELETE FROM sessions WHERE user_id=%s", (user.user_id,))

    def create_reset(self, email: str, raw_token: str, business_id: UUID | None = None) -> bool:
        if business_id is None:
            rows = self.conn.execute(
                "SELECT id FROM users WHERE email=%s AND is_active ORDER BY id",
                (email.strip().lower(),),
            ).fetchall()
            if len(rows) != 1:
                return False
            row = rows[0]
        else:
            row = self.conn.execute(
                "SELECT id FROM users WHERE business_id=%s AND email=%s AND is_active",
                (business_id, email.strip().lower()),
            ).fetchone()
        if not row:
            return False
        self.conn.execute(
            "UPDATE password_reset_tokens SET consumed_at=now() WHERE user_id=%s AND consumed_at IS NULL",
            (row["id"],),
        )
        self.conn.execute(
            "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES(%s,%s,now()+interval '30 minutes')",
            (row["id"], token_hash(raw_token)),
        )
        return True

    def consume_reset(self, raw_token: str, password: str) -> None:
        if not 12 <= len(password) <= 128:
            raise HTTPException(422, "Password must contain 12 to 128 characters")
        with self.conn.transaction():
            row = self.conn.execute(
                """UPDATE password_reset_tokens SET consumed_at=now()
                WHERE token_hash=%s AND consumed_at IS NULL AND expires_at>now() RETURNING user_id""",
                (token_hash(raw_token),),
            ).fetchone()
            if not row:
                raise HTTPException(400, "Reset link is invalid or expired")
            self.conn.execute(
                "UPDATE users SET password_hash=%s,password_changed_at=now() WHERE id=%s",
                (hash_password(password), row["user_id"]),
            )
            self.conn.execute("DELETE FROM sessions WHERE user_id=%s", (row["user_id"],))

    def create_invitation(self, owner: Principal, email: str, display_name: str, raw_token: str):
        if owner.role != "owner":
            raise HTTPException(403, "Owner role required")
        normalized = email.strip().lower()
        if self.email_exists(normalized):
            raise HTTPException(409, "An account with this email already exists")
        with self.conn.transaction():
            self.conn.execute(
                "UPDATE staff_invitations SET revoked_at=now() WHERE business_id=%s AND email=%s AND accepted_at IS NULL AND revoked_at IS NULL",
                (owner.business_id, normalized),
            )
            row = self.conn.execute(
                """INSERT INTO staff_invitations(business_id,email,display_name,token_hash,invited_by,expires_at)
                VALUES(%s,%s,%s,%s,%s,now()+interval '48 hours') RETURNING id,expires_at""",
                (
                    owner.business_id,
                    normalized,
                    display_name.strip(),
                    token_hash(raw_token),
                    owner.user_id,
                ),
            ).fetchone()
        return {
            "id": str(row["id"]),
            "email": normalized,
            "displayName": display_name.strip(),
            "expiresAt": row["expires_at"].isoformat(),
        }

    def accept_invitation(self, raw_token: str, password: str, hours: int):
        if not 12 <= len(password) <= 128:
            raise HTTPException(422, "Password must contain 12 to 128 characters")
        with self.conn.transaction():
            invite = self.conn.execute(
                """UPDATE staff_invitations SET accepted_at=now()
                WHERE token_hash=%s AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING *""",
                (token_hash(raw_token),),
            ).fetchone()
            if not invite:
                raise HTTPException(400, "Invitation is invalid or expired")
            row = self.conn.execute(
                """INSERT INTO users(business_id,email,display_name,role,password_hash,password_changed_at)
                VALUES(%s,%s,%s,'staff',%s,now()) RETURNING *""",
                (
                    invite["business_id"],
                    invite["email"],
                    invite["display_name"],
                    hash_password(password),
                ),
            ).fetchone()
            return self.issue_session(self._principal(row), hours)

    def list_members(self, owner: Principal):
        if owner.role != "owner":
            raise HTTPException(403, "Owner role required")
        return [
            {
                "id": str(r["id"]),
                "email": r["email"],
                "displayName": r["display_name"],
                "role": r["role"],
                "isActive": r["is_active"],
            }
            for r in self.conn.execute(
                "SELECT id,email,display_name,role,is_active FROM users WHERE business_id=%s ORDER BY role,email",
                (owner.business_id,),
            ).fetchall()
        ]

    def set_staff_active(self, owner: Principal, user_id: UUID, active: bool):
        if owner.role != "owner":
            raise HTTPException(403, "Owner role required")
        row = self.conn.execute(
            """UPDATE users SET is_active=%s WHERE business_id=%s AND id=%s AND role='staff' RETURNING id""",
            (active, owner.business_id, user_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Staff member not found")
        if not active:
            self.conn.execute("DELETE FROM sessions WHERE user_id=%s", (user_id,))
        return {"id": str(user_id), "isActive": active}

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

    def create_pending(self, token_hash: str, subject: str, email: str, display_name: str) -> None:
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
