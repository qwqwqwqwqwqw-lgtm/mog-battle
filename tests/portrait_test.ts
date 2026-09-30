import { decodePhoto } from "../supabase/functions/_shared/raster.ts";
import {
  decoratedPhoto,
  validatePng,
} from "../supabase/functions/_shared/portrait.ts";
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
Deno.test(
  "portrait renders a cropped photo with the purchased frame and title",
  async () => {
    const source = await Deno.readFile(
      new URL("../npc/npc001.jpg", import.meta.url),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(source));
    let resultBytes: Uint8Array | null = null;
    let savedPath = "";
    const db = {
      from: () => ({
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [
                {
                  kind: "frame",
                  visual_key: "afterhours",
                  name: "AFTER HOURS",
                },
                { kind: "title", name: "NIGHT MOGGER" },
              ],
              error: null,
            }),
        }),
      }),
      storage: {
        from: () => ({
          upload: async (path: string, bytes: Uint8Array) => {
            savedPath = path;
            resultBytes = bytes;
            return { error: null };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: "https://example.test/" + path },
          }),
        }),
      },
    };
    try {
      const rendered = await decoratedPhoto(db, {
        telegram_id: 123,
        profile_photo_url:
          "https://qwqwqwqwqwqw-lgtm.github.io/mog-battle/npc/npc001.jpg",
        equipped_frame: "frame-id",
        equipped_title: "title-id",
      });
      assert(rendered.title === "NIGHT MOGGER", "title missing");
      assert(/^123\/render_[a-f0-9]{20}\.jpg$/.test(savedPath), "unsafe path");
      const decoded = decodePhoto(resultBytes!);
      assert(
        decoded.width === 600 && decoded.height === 760,
        "invalid rendered size",
      );
      assert(resultBytes!.length < 1000000, "portrait too large");
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
Deno.test("share image rejects arbitrary or oversized content", () => {
  for (const input of [new Uint8Array(1), new Uint8Array(3 * 1024 * 1024)]) {
    let rejected = false;
    try {
      validatePng(input);
    } catch {
      rejected = true;
    }
    assert(rejected, "invalid file accepted");
  }
});
