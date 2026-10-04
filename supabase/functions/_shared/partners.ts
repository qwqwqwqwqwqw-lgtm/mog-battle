// A channel membership check never trusts a client-side click or reward amount.
export function memberPresent(member: {
  status?: string;
  is_member?: boolean;
}): boolean {
  return (
    ["member", "administrator", "creator"].includes(member.status || "") ||
    (member.status === "restricted" && member.is_member === true)
  );
}

export async function verifyPartnerMembership(
  token: string,
  username: string,
  userId: number,
): Promise<boolean> {
  if (
    !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username) ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  )
    throw new Error("partner_verification_unavailable");
  const api = async (method: string, body: Record<string, unknown> = {}) => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (!r.ok || !j.ok || !j.result) throw new Error("unavailable");
      return j.result;
    } catch {
      throw new Error("partner_verification_unavailable");
    }
  };
  const bot = await api("getMe");
  const ownMember = await api("getChatMember", {
    chat_id: "@" + username,
    user_id: bot.id,
  });
  if (!["administrator", "creator"].includes(ownMember.status))
    throw new Error("partner_verification_unavailable");
  const member = await api("getChatMember", {
    chat_id: "@" + username,
    user_id: userId,
  });
  return memberPresent(member);
}
