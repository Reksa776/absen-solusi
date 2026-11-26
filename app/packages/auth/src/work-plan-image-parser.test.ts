import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanWorkPlanImageLine,
  extractWorkPlanFromImage,
  extractWorkPlanItemsFromImage,
  parseWorkPlanTextLines,
  WORK_PLAN_IMAGE_ITEM_MAX_LENGTH,
  WORK_PLAN_IMAGE_MAX_ITEMS,
} from "./work-plan-image-parser.js";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** PNG minimal dengan metadata tEXt, dipakai fallback OCR tanpa worker. */
function pngWithText(text: string): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([
      length,
      Buffer.from(type, "latin1"),
      data,
      Buffer.alloc(4),
    ]);
  };
  const textData = Buffer.concat([
    Buffer.from("Description", "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "utf8"),
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("tEXt", textData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function jsonFetch(
  payload: unknown,
  inspect?: (url: string, init: RequestInit | undefined) => void,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    inspect?.(String(input), init);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

test("parser membersihkan bullet, nomor, checkbox, dan label", () => {
  assert.equal(cleanWorkPlanImageLine("- Menyusun laporan"), "Menyusun laporan");
  assert.equal(cleanWorkPlanImageLine("2. Menyiapkan meeting"), "Menyiapkan meeting");
  assert.equal(cleanWorkPlanImageLine("[x] Membalas email klien"), "Membalas email klien");
  assert.equal(cleanWorkPlanImageLine("• Tugas: Update stok gudang"), "Update stok gudang");
  assert.equal(cleanWorkPlanImageLine("  **Rapikan  arsip**  "), "Rapikan arsip");
});

test("parser memecah baris OCR yang menggabungkan beberapa butir", () => {
  const items = parseWorkPlanTextLines(
    "1. Menyusun laporan 2. Menyiapkan meeting - Membalas email",
  );
  assert.deepEqual(items, [
    "Menyusun laporan",
    "Menyiapkan meeting",
    "Membalas email",
  ]);
});

test("parser mendeduplikasi, membuang judul, dan membatasi panjang item", () => {
  const long = `Menyusun ${"laporan bulanan ".repeat(40)}`;
  const items = parseWorkPlanTextLines(
    ["Rencana Kerja Hari Ini", "To-Do List", "- Menyusun laporan", "menyusun LAPORAN", long, "-", "ok"].join(
      "\n",
    ),
  );
  assert.equal(items[0], "Menyusun laporan");
  assert.equal(items.filter((item) => item.toLowerCase() === "menyusun laporan").length, 1);
  assert.equal(items.every((item) => item.length <= WORK_PLAN_IMAGE_ITEM_MAX_LENGTH), true);
  assert.equal(items.some((item) => /rencana kerja|to-do/i.test(item)), false);
  assert.equal(items.some((item) => item === "ok"), false);
});

test("parser membatasi maksimal 20 item", () => {
  const text = Array.from({ length: 25 }, (_, index) => `- Tugas nomor ${index + 1}`).join("\n");
  const items = parseWorkPlanTextLines(text);
  assert.equal(items.length, WORK_PLAN_IMAGE_MAX_ITEMS);
  assert.equal(items[0], "Tugas nomor 1");
  assert.equal(items.at(-1), `Tugas nomor ${WORK_PLAN_IMAGE_MAX_ITEMS}`);
});

test("vision Gemini dipakai lebih dulu saat GEMINI_API_KEY tersedia", async () => {
  const buffer = pngWithText("abaikan");
  let calledUrl = "";
  let calledBody = "";
  const fetchImpl = jsonFetch(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '```json\n["- Menyusun laporan penjualan", "2. Menyiapkan materi meeting klien"]\n```',
              },
            ],
          },
        },
      ],
    },
    (url, init) => {
      calledUrl = url;
      calledBody = String(init?.body ?? "");
    },
  );

  const result = await extractWorkPlanFromImage(buffer, "image/png", {
    env: { GEMINI_API_KEY: "test-key" },
    fetchImpl,
  });

  assert.equal(result.source, "vision");
  assert.deepEqual(result.items, [
    "Menyusun laporan penjualan",
    "Menyiapkan materi meeting klien",
  ]);
  assert.match(calledUrl, /generativelanguage\.googleapis\.com/);
  assert.equal(calledBody.includes(buffer.toString("base64")), true);
});

test("vision OpenAI dipakai saat hanya OPENAI_API_KEY tersedia", async () => {
  const result = await extractWorkPlanFromImage(pngWithText("abaikan"), "image/png", {
    env: { OPENAI_API_KEY: "test-key" },
    fetchImpl: jsonFetch({
      choices: [{ message: { content: '["Membalas email klien"]' } }],
    }),
  });
  assert.equal(result.source, "vision");
  assert.deepEqual(result.items, ["Membalas email klien"]);
});

test("tanpa API key, OCR lokal membersihkan bullet dan nomor", async () => {
  const result = await extractWorkPlanFromImage(pngWithText("abaikan"), "image/png", {
    env: {},
    ocr: async () =>
      [
        "Rencana Kerja Hari Ini",
        "- Menyusun laporan penjualan",
        "2) Menyiapkan materi meeting",
        "• Menyusun laporan penjualan",
      ].join("\n"),
  });
  assert.equal(result.source, "ocr");
  assert.deepEqual(result.items, [
    "Menyusun laporan penjualan",
    "Menyiapkan materi meeting",
  ]);
});

test("vision gagal/timeout jatuh ke OCR lokal", async () => {
  const failingFetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const result = await extractWorkPlanFromImage(pngWithText("abaikan"), "image/png", {
    env: { GEMINI_API_KEY: "test-key" },
    fetchImpl: failingFetch,
    ocr: async () => "- Membalas email vendor",
  });
  assert.equal(result.source, "ocr");
  assert.deepEqual(result.items, ["Membalas email vendor"]);
});

test("OCR dimatikan memakai teks metadata PNG, bukan exception", async () => {
  const result = await extractWorkPlanFromImage(
    pngWithText("Rencana Kerja\n- Menyusun laporan\n- Menyiapkan meeting"),
    "image/png",
    { env: { WORK_PLAN_OCR_DISABLED: "1" } },
  );
  assert.equal(result.source, "ocr");
  assert.deepEqual(result.items, ["Menyusun laporan", "Menyiapkan meeting"]);
});

test("gambar kosong atau bukan gambar mengembalikan array kosong", async () => {
  assert.deepEqual(
    await extractWorkPlanItemsFromImage(Buffer.alloc(0), "image/png", { env: {} }),
    [],
  );
  assert.deepEqual(
    await extractWorkPlanItemsFromImage(Buffer.from("bukan gambar"), "text/plain", {
      env: {},
    }),
    [],
  );
  const blurry = await extractWorkPlanFromImage(pngWithText(""), "image/png", {
    env: { WORK_PLAN_OCR_DISABLED: "1" },
  });
  assert.deepEqual(blurry, { items: [], source: "ocr" });
});
