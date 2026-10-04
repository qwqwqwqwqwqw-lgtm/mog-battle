import {
  memberPresent,
  verifyPartnerMembership,
} from "../supabase/functions/_shared/partners.ts";
function assert(v: unknown, message = "assertion failed") {
  if (!v) throw new Error(message);
}
Deno.test(
  "Telegram membership handles restricted, departed and unknown states",
  () => {
    for (const status of ["member", "administrator", "creator"])
      assert(memberPresent({ status }));
    for (const status of ["left", "kicked", "unknown", undefined])
      assert(!memberPresent({ status }));
    assert(!memberPresent({ status: "restricted", is_member: false }));
    assert(memberPresent({ status: "restricted", is_member: true }));
  },
);
Deno.test(
  "partner verification requires bot administration and fails closed on Telegram errors",
  async () => {
    const oldFetch = globalThis.fetch;
    let status = "administrator",
      userStatus = "member",
      apiError = false,
      calls = 0;
    globalThis.fetch = async (input, options) => {
      calls++;
      const method = String(input).split("/").at(-1);
      const body = JSON.parse(String(options?.body));
      return Response.json(
        apiError
          ? { ok: false }
          : {
              ok: true,
              result:
                method === "getMe"
                  ? { id: 999 }
                  : { status: body.user_id === 999 ? status : userStatus },
            },
      );
    };
    try {
      assert(await verifyPartnerMembership("fixture", "validchannel", 123));
      userStatus = "left";
      assert(!(await verifyPartnerMembership("fixture", "validchannel", 123)));
      status = "member";
      let rejected = false;
      try {
        await verifyPartnerMembership("fixture", "validchannel", 123);
      } catch (e) {
        rejected = e instanceof Error && e.message === "partner_verification_unavailable";
      }
      assert(rejected, "non-admin bot accepted");
      apiError = true;
      rejected = false;
      try {
        await verifyPartnerMembership("fixture", "validchannel", 123);
      } catch (e) {
        rejected = e instanceof Error && e.message === "partner_verification_unavailable";
      }
      assert(rejected, "Telegram error accepted");
      const before = calls;
      rejected = false;
      try {
        await verifyPartnerMembership("fixture", "https://bad.test", 123);
      } catch {
        rejected = true;
      }
      assert(rejected && calls === before, "invalid channel made an API call");
    } finally {
      globalThis.fetch = oldFetch;
    }
  },
);
