import { decodePhoto, renderPhoto } from "./raster.ts";

export function validatePng(bytes: Uint8Array) {
  if (
    bytes.byteLength < 24 ||
    bytes.byteLength > 2 * 1024 * 1024 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  )
    throw new Error("invalid_share_image");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (width !== 900 || height !== 1200) throw new Error("invalid_share_size");
}
export const html = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const colors: Record<string, string> = {
  firstlight: "#d9ff67",
  afterhours: "#c9a3ff",
  chromeclub: "#dbe5ee",
  apex: "#eec973",
  prism: "#d9a5ff",
  chromeface: "#dbe5ee",
  celestial: "#f6d993",
  ice: "#bfeaff",
  rose: "#f0a3bd",
  emerald: "#70f0bb",
  void: "#7e63cf",
  bloodmoon: "#d24855",
  halo: "#f0d38b",
  truepeak: "#ffffff",
  focus: "#d9ff67",
  pslscan: "#d9f7ff",
  facecard: "#eeeeee",
  unfrauded: "#ff405d",
  outmog: "#ffdf6b",
};
export async function decoratedPhoto(db: any, player: any) {
  const original = String(player.profile_photo_url || "");
  const url = new URL(original);
  if (
    url.protocol !== "https:" ||
    ![
      "zjznmcydpngceiblqtwj.supabase.co",
      "qwqwqwqwqwqw-lgtm.github.io",
    ].includes(url.hostname)
  )
    throw new Error("invalid_photo_origin");
  const ids = [
    player.equipped_frame,
    player.equipped_background,
    player.equipped_title,
  ].filter(Boolean);
  const q = ids.length
    ? await db
        .from("cosmetics")
        .select("id,kind,name,visual_key,code")
        .in("id", ids)
    : { data: [], error: null };
  if (q.error) throw q.error;
  const frame = q.data.find((x: any) => x.kind === "frame"),
    background = q.data.find((x: any) => x.kind === "profile_bg"),
    title = q.data.find((x: any) => x.kind === "title");
  const visual = String(frame?.visual_key || frame?.code || "")
    .replace(/^frame_/, "")
    .replace(/_/g, "");
  const bytes = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  }).then(async (r) => {
    if (!r.ok) throw new Error("photo_fetch_failed");
    const b = new Uint8Array(await r.arrayBuffer());
    if (b.byteLength > 5 * 1024 * 1024) throw new Error("image_too_large");
    return b;
  });
  const decoded = decodePhoto(bytes);
  const backgroundKey = String(background?.visual_key || "");
  const backdrop =
    backgroundKey === "midnight"
      ? "#221d32"
      : backgroundKey === "goldroom"
        ? "#302719"
        : backgroundKey === "liquidchrome"
          ? "#252b34"
          : "#101211";
  const encoded = renderPhoto(
    decoded,
    backdrop,
    frame ? colors[visual] || "#d9ff67" : null,
  );
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(original + JSON.stringify(ids)),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
  const path = player.telegram_id + "/render_" + digest + ".jpg";
  const saved = await db.storage
    .from("profile-photos")
    .upload(path, encoded, { contentType: "image/jpeg", upsert: true });
  if (saved.error) throw saved.error;
  return {
    url: db.storage.from("profile-photos").getPublicUrl(path).data.publicUrl,
    title: title?.name || "",
  };
}
export async function cleanupCards(db: any, telegramId: number) {
  const folder = String(telegramId);
  // Remove server-created copies too when a player removes their photo.
  for (let page = 0; page < 5; page++) {
    const listed = await db.storage
      .from("profile-photos")
      .list(folder, { limit: 1000 });
    if (listed.error) throw listed.error;
    const files = (listed.data || [])
      .filter((f: any) => /^(share_|render_)/.test(f.name))
      .map((f: any) => folder + "/" + f.name);
    if (!files.length) return;
    const removed = await db.storage.from("profile-photos").remove(files);
    if (removed.error) throw removed.error;
  }
}
