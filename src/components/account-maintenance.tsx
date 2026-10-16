import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AccountMember } from "@/lib/api";
import { usePermissions } from "@/lib/permissions";
import { useAppStore } from "@/lib/store";

type MembersStatus = "idle" | "loading" | "ready" | "error";

export function AccountMaintenance() {
  const { canManageMembers } = usePermissions();
  const session = useAppStore((state) => state.session);
  const accountKey = session ? `${session.businessId}/${session.userId}/${session.role}` : "";
  const ownerKey = canManageMembers ? accountKey : null;
  const [current, setCurrent] = useState("");
  const [replacement, setReplacement] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [membersStatus, setMembersStatus] = useState<MembersStatus>(ownerKey ? "loading" : "idle");
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionLock = useRef<string | null>(null);
  const accountVersion = useRef(0);
  const listVersion = useRef(0);
  const busy = pendingAction !== null;
  const staffMembers = members.filter((member) => member.role === "staff");

  const loadMembers = useCallback(
    async (failurePrefix = "Unable to load staff access.") => {
      if (!ownerKey) return;
      const requestVersion = ++listVersion.current;
      setMembersStatus("loading");
      setMembersError(null);
      try {
        const loaded = await api.members();
        if (requestVersion !== listVersion.current) return;
        setMembers(loaded);
        setMembersStatus("ready");
      } catch (error) {
        if (requestVersion !== listVersion.current) return;
        setMembersStatus("error");
        setMembersError(`${failurePrefix} ${errorMessage(error, "Please try again.")}`);
      }
    },
    [ownerKey],
  );

  useEffect(() => {
    accountVersion.current += 1;
    listVersion.current += 1;
    actionLock.current = null;
    setPendingAction(null);
    setMembers([]);
    setMembersError(null);
    setMemberActionError(null);
    setPasswordError(null);
    setInvitationError(null);
    setCurrent("");
    setReplacement("");
    setName("");
    setEmail("");
    if (ownerKey) void loadMembers();
    else setMembersStatus("idle");
    return () => {
      accountVersion.current += 1;
      listVersion.current += 1;
    };
  }, [accountKey, ownerKey, loadMembers]);

  function beginAction(action: string) {
    if (actionLock.current) return false;
    actionLock.current = action;
    setPendingAction(action);
    return true;
  }

  function finishAction(action: string, version: number) {
    if (version !== accountVersion.current || actionLock.current !== action) return;
    actionLock.current = null;
    setPendingAction(null);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!session || !current || replacement.length < 12 || !beginAction("password")) return;
    const version = accountVersion.current;
    setPasswordError(null);
    try {
      await api.changePassword(current, replacement);
      if (version !== accountVersion.current) return;
      toast.success("Password changed. Sign in again on all devices.");
      window.location.reload();
    } catch (error) {
      if (version !== accountVersion.current) return;
      const message = errorMessage(error, "The password could not be changed.");
      setPasswordError(message);
      toast.error(message);
    } finally {
      finishAction("password", version);
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!canManageMembers || !name.trim() || !email.trim() || !beginAction("invitation")) return;
    const version = accountVersion.current;
    setInvitationError(null);
    try {
      await api.inviteStaff(email.trim(), name.trim());
      if (version !== accountVersion.current) return;
      setEmail("");
      setName("");
      toast.success("Single-use staff invitation sent.");
    } catch (error) {
      if (version !== accountVersion.current) return;
      const message = errorMessage(error, "The staff invitation could not be sent.");
      setInvitationError(message);
      toast.error(message);
    } finally {
      finishAction("invitation", version);
    }
  }

  async function toggleMember(member: AccountMember) {
    const action = `member:${member.id}`;
    if (
      !canManageMembers ||
      member.role !== "staff" ||
      membersStatus !== "ready" ||
      !beginAction(action)
    )
      return;
    const version = accountVersion.current;
    setMemberActionError(null);
    try {
      await api.setMemberActive(member.id, !member.isActive);
      if (version !== accountVersion.current) return;
      setMembers((listed) =>
        listed.map((item) =>
          item.id === member.id ? { ...item, isActive: !member.isActive } : item,
        ),
      );
      toast.success(member.isActive ? "Staff access disabled." : "Staff access restored.");
      await loadMembers("Staff access was updated, but the staff list could not be refreshed.");
    } catch (error) {
      if (version !== accountVersion.current) return;
      const message = errorMessage(error, "Staff access could not be updated.");
      setMemberActionError(message);
      toast.error(message);
    } finally {
      finishAction(action, version);
    }
  }

  return (
    <div className="grid gap-4 rounded-xl border border-border p-4">
      <div>
        <p className="font-medium">Account maintenance</p>
        <p className="text-sm text-muted">
          Changing your password ends every active session. Recovery and invitation links are
          single-use and expire.
        </p>
      </div>
      <form onSubmit={changePassword} className="grid gap-3">
        <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="account-current-password">Current password</Label>
            <Input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="account-new-password">New password</Label>
            <Input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              placeholder="At least 12 characters"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
          </div>
        </fieldset>
        {passwordError && (
          <p className="text-sm text-danger" role="alert">
            {passwordError}
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !session || !current || replacement.length < 12}
        >
          {pendingAction === "password" ? "Changing password…" : "Change password"}
        </Button>
      </form>
      {canManageMembers && (
        <>
          <div className="border-t border-border pt-4">
            <p className="font-medium">Invite staff</p>
            <p className="text-sm text-muted">Requires private SMTP configuration on the server.</p>
          </div>
          <form onSubmit={invite} className="grid gap-3">
            <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="invite-staff-name">Staff name</Label>
                <Input
                  id="invite-staff-name"
                  type="text"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite-staff-email">Staff email</Label>
                <Input
                  id="invite-staff-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="staff@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </fieldset>
            {invitationError && (
              <p className="text-sm text-danger" role="alert">
                {invitationError}
              </p>
            )}
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !name.trim() || !email.trim()}
            >
              {pendingAction === "invitation" ? "Sending invitation…" : "Send staff invitation"}
            </Button>
          </form>
          <div
            className="grid gap-3 border-t border-border pt-4"
            aria-busy={membersStatus === "loading" || pendingAction?.startsWith("member:")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Staff access</p>
              {membersStatus === "ready" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void loadMembers()}
                >
                  Refresh staff list
                </Button>
              )}
            </div>
            {membersStatus === "loading" && (
              <p className="text-sm text-muted" role="status">
                Loading staff access…
              </p>
            )}
            {membersStatus === "error" && (
              <div className="grid gap-2" role="alert">
                <p className="text-sm text-danger">{membersError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  disabled={busy}
                  onClick={() => void loadMembers()}
                >
                  Retry loading staff
                </Button>
              </div>
            )}
            {memberActionError && (
              <p className="text-sm text-danger" role="alert">
                {memberActionError}
              </p>
            )}
            {membersStatus === "ready" && staffMembers.length === 0 && (
              <p className="text-sm text-muted">No staff accounts are listed.</p>
            )}
            {staffMembers.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 p-3 text-sm"
              >
                <span>
                  {member.displayName} · {member.email} · {member.isActive ? "active" : "disabled"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || membersStatus !== "ready"}
                  onClick={() => void toggleMember(member)}
                >
                  {pendingAction === `member:${member.id}`
                    ? member.isActive
                      ? "Disabling…"
                      : "Restoring…"
                    : member.isActive
                      ? "Disable"
                      : "Restore"}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
