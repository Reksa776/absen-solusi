import { HttpError } from "./http.js";

/** Batas unggahan gambar rencana kerja yang dibaca menjadi to-do list. */
export const MAX_WORK_PLAN_IMAGE_BYTES = 8 * 1024 * 1024;
export const WORK_PLAN_IMAGE_MAX_ITEMS = 20;
export const WORK_PLAN_IMAGE_ITEM_MAX_LENGTH = 200;

export const WORK_PLAN_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type WorkPlanImageMimeType = (typeof WORK_PLAN_IMAGE_MIME_TYPES)[number];

/** Engine yang benar-benar menghasilkan item: vision LLM atau OCR lokal. */
export type WorkPlanImageSource = "vision" | "ocr";

export type WorkPlanImageExtraction = {
  items: string[];
  source: WorkPlanImageSource;
};

export type WorkPlanImageExtractionOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Pengganti OCR lokal; dipakai test agar tidak menyentuh worker/wasm. */
  ocr?: (buffer: Buffer, mimeType: WorkPlanImageMimeType) => Promise<string>;
  visionTimeoutMs?: number;
  ocrTimeoutMs?: number;
};

const VISION_TIMEOUT_MS = 15_000;
const OCR_TIMEOUT_MS = 20_000;

const VISION_PROMPT = [
  "Baca gambar ini dan ekstrak daftar pekerjaan, tugas, atau catatan rencana kerja",
  "(tulisan tangan, papan tulis, atau tangkapan layar aplikasi catatan).",
  "Balas HANYA dengan array JSON berisi string singkat berbahasa Indonesia.",
  "Aturan: maksimal 20 item, satu tugas per item, tanpa simbol bullet, tanpa nomor,",
  "tanpa penjelasan tambahan, maksimal 200 karakter per item.",
  "Lewati judul, tanggal, nama orang, dan coretan yang tidak terbaca.",
  'Contoh: ["Menyusun laporan penjualan", "Menyiapkan materi meeting klien"]',
].join(" ");

/** Deteksi tipe gambar dari magic bytes agar nama file/header tidak dipercaya. */
export function detectWorkPlanImageMimeType(
  bytes: Uint8Array,
): WorkPlanImageMimeType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function normalizeWorkPlanImageMimeType(
  value: string | null | undefined,
): WorkPlanImageMimeType | null {
  const normalized = (value ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  return (WORK_PLAN_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)
    ? (normalized as WorkPlanImageMimeType)
    : null;
}

const BULLET_PATTERN =
  /^(?:[-*•·‣▪◦–—+]|\(?\d{1,2}[.)]|\[\s*[xX✓]?\s*\]|[a-zA-Z][.)])\s*/;
const LABEL_PATTERN =
  /^(?:to-?do(?:\s*list)?|daftar\s+(?:tugas|pekerjaan)|rencana\s+kerja(?:\s+hari\s+ini)?|work\s*plan|plan(?:ning)?|tasks?|tugas|catatan|notes?)\s*[:\-]\s*/i;
const HEADER_ONLY =
  /^(?:to-?do(?:\s*list)?|daftar\s+(?:tugas|pekerjaan)|rencana\s+kerja(?:\s+hari\s+ini)?|work\s*plan|plan(?:ning)?|hari\s+ini|today|tasks?|catatan|notes?)$/i;

function splitCandidateLines(text: string): string[] {
  const pieces: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // OCR sering menggabungkan beberapa butir dalam satu baris: "1. A 2. B".
    pieces.push(...line.split(/\s+(?=(?:[-*•·]|\d{1,2}[.)])\s+)/));
  }
  return pieces;
}

/** Bersihkan bullet, nomor, label, dan noise karakter dari satu baris. */
export function cleanWorkPlanImageLine(raw: string): string {
  let text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text
      .replace(BULLET_PATTERN, "")
      .replace(LABEL_PATTERN, "")
      .trim();
  }
  text = text
    .replace(/^[\s:;,.|>\-–—]+/, "")
    .replace(/[\s:;,|]+$/, "")
    .trim();
  if (text.length > WORK_PLAN_IMAGE_ITEM_MAX_LENGTH) {
    const cut = text.slice(0, WORK_PLAN_IMAGE_ITEM_MAX_LENGTH);
    const space = cut.lastIndexOf(" ");
    text = (space > 80 ? cut.slice(0, space) : cut).trim();
  }
  return text;
}

function isUsefulLine(text: string): boolean {
  if (text.length < 3) return false;
  if (HEADER_ONLY.test(text)) return false;
  const letters = (text.match(/[a-zA-Z\u00c0-\u024f]/g) ?? []).length;
  return letters >= 2;
}

function dedupeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Ubah teks mentah (OCR/vision) menjadi daftar tugas yang rapi. */
export function parseWorkPlanTextLines(text: string): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  for (const piece of splitCandidateLines(text)) {
    const item = cleanWorkPlanImageLine(piece);
    if (!isUsefulLine(item)) continue;
    const key = dedupeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= WORK_PLAN_IMAGE_MAX_ITEMS) break;
  }
  return items;
}

function parseVisionPayload(text: string): string[] | null {
  const trimmed = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { items?: unknown }).items)
      ) {
        return ((parsed as { items: unknown[] }).items).filter(
          (entry): entry is string => typeof entry === "string",
        );
      }
    } catch {
      // coba kandidat berikutnya
    }
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type VisionProvider = { provider: "gemini" | "openai"; apiKey: string };

function resolveVisionProvider(
  env: NodeJS.ProcessEnv,
): VisionProvider | null {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (geminiKey) return { provider: "gemini", apiKey: geminiKey };
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) return { provider: "openai", apiKey: openaiKey };
  return null;
}

async function callGemini(
  buffer: Buffer,
  mimeType: WorkPlanImageMimeType,
  provider: VisionProvider,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const model = env.GEMINI_VISION_MODEL?.trim() || "gemini-2.0-flash";
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": provider.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: VISION_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) throw new Error(`vision http ${response.status}`);
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

async function callOpenAi(
  buffer: Buffer,
  mimeType: WorkPlanImageMimeType,
  provider: VisionProvider,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const model = env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini";
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${buffer.toString("base64")}`,
              },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`vision http ${response.status}`);
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return payload.choices?.[0]?.message?.content ?? "";
}

/**
 * Prioritas 1: minta daftar tugas ke vision LLM bila API key tersedia.
 * `null` berarti tidak ada key atau hasilnya tidak dapat dipakai, sehingga
 * pemanggil jatuh ke OCR lokal.
 */
async function extractWithVision(
  buffer: Buffer,
  mimeType: WorkPlanImageMimeType,
  options: WorkPlanImageExtractionOptions,
): Promise<string[] | null> {
  const env = options.env ?? process.env;
  const provider = resolveVisionProvider(env);
  if (!provider) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.visionTimeoutMs ?? VISION_TIMEOUT_MS;
  try {
    const text =
      provider.provider === "gemini"
        ? await callGemini(buffer, mimeType, provider, fetchImpl, timeoutMs, env)
        : await callOpenAi(buffer, mimeType, provider, fetchImpl, timeoutMs, env);
    const parsed = parseVisionPayload(text);
    if (!parsed || parsed.length === 0) return null;
    const items = parseWorkPlanTextLines(parsed.join("\n"));
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

type OcrWorker = {
  recognize: (image: Buffer) => Promise<{ data: { text?: string } }>;
  terminate: () => Promise<unknown>;
};

let ocrWorkerPromise: Promise<OcrWorker> | null = null;

function getOcrWorker(): Promise<OcrWorker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js")
      .then((module) =>
        module.createWorker(["ind", "eng"], 1, {
          logger: () => {},
          errorHandler: () => {},
        }) as unknown as Promise<OcrWorker>,
      )
      .catch((error: unknown) => {
        ocrWorkerPromise = null;
        throw error;
      });
  }
  return ocrWorkerPromise;
}

/** Teks yang tertanam di metadata PNG (tEXt/iTXt), mis. hasil screenshot. */
function pngEmbeddedText(bytes: Buffer): string[] {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) {
    return [];
  }
  const texts: string[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (length < 0 || end + 4 > bytes.length) break;
    if (type === "tEXt") {
      const chunk = bytes.subarray(start, end);
      const separator = chunk.indexOf(0);
      if (separator >= 0) texts.push(chunk.toString("utf8", separator + 1));
    } else if (type === "iTXt") {
      const chunk = bytes.subarray(start, end);
      const keywordEnd = chunk.indexOf(0);
      if (keywordEnd >= 0 && keywordEnd + 3 <= chunk.length) {
        const compressed = chunk[keywordEnd + 1] === 1;
        const languageEnd = chunk.indexOf(0, keywordEnd + 3);
        const translatedEnd =
          languageEnd >= 0 ? chunk.indexOf(0, languageEnd + 1) : -1;
        if (!compressed && translatedEnd >= 0) {
          texts.push(chunk.toString("utf8", translatedEnd + 1));
        }
      }
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  return texts;
}

function ocrDisabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.WORK_PLAN_OCR_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Prioritas 2: OCR lokal. Worker tesseract.js di-cache antar request; bila
 * worker/wasm/traineddata tidak tersedia (offline atau sengaja dimatikan),
 * pakai teks yang tertanam di metadata gambar. Tidak pernah melempar error.
 */
async function extractWithLocalOcr(
  buffer: Buffer,
  mimeType: WorkPlanImageMimeType,
  options: WorkPlanImageExtractionOptions,
): Promise<string> {
  if (options.ocr) return options.ocr(buffer, mimeType);
  const env = options.env ?? process.env;
  if (!ocrDisabled(env)) {
    const timeoutMs = options.ocrTimeoutMs ?? OCR_TIMEOUT_MS;
    try {
      const worker = await withTimeout(getOcrWorker(), timeoutMs);
      const result = await withTimeout(worker.recognize(buffer), timeoutMs);
      const text = result.data.text ?? "";
      if (text.trim()) return text;
    } catch {
      ocrWorkerPromise = null;
    }
  }
  return pngEmbeddedText(buffer).join("\n");
}

/**
 * Ekstraksi cerdas: vision LLM lebih dulu bila key tersedia, lalu OCR lokal.
 * Selalu mengembalikan daftar bersih; gambar buram/kosong menghasilkan array
 * kosong, bukan exception.
 */
export async function extractWorkPlanFromImage(
  buffer: Buffer,
  mimeType: string,
  options: WorkPlanImageExtractionOptions = {},
): Promise<WorkPlanImageExtraction> {
  const mime =
    normalizeWorkPlanImageMimeType(mimeType) ??
    detectWorkPlanImageMimeType(buffer);
  if (!mime || buffer.length === 0) {
    return { items: [], source: "ocr" };
  }
  const visionItems = await extractWithVision(buffer, mime, options);
  if (visionItems && visionItems.length > 0) {
    return { items: visionItems, source: "vision" };
  }
  try {
    const text = await extractWithLocalOcr(buffer, mime, options);
    return { items: parseWorkPlanTextLines(text), source: "ocr" };
  } catch {
    return { items: [], source: "ocr" };
  }
}

export async function extractWorkPlanItemsFromImage(
  buffer: Buffer,
  mimeType: string,
  options: WorkPlanImageExtractionOptions = {},
): Promise<string[]> {
  return (await extractWorkPlanFromImage(buffer, mimeType, options)).items;
}

/**
 * Validasi unggahan multipart (`image`, maks 8 MB) lalu ekstrak daftar tugas.
 * Dipakai route mobile dan alias web agar aturannya identik.
 */
export async function extractWorkPlanItemsFromUpload(
  request: Request,
): Promise<WorkPlanImageExtraction> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new HttpError(
      400,
      "INVALID_IMAGE_UPLOAD",
      "Kirim gambar rencana kerja sebagai multipart/form-data",
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "INVALID_IMAGE_UPLOAD", "Form gambar tidak valid");
  }
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    throw new HttpError(
      400,
      "IMAGE_REQUIRED",
      "Gambar rencana kerja wajib diunggah pada field image",
    );
  }
  if (file.size > MAX_WORK_PLAN_IMAGE_BYTES) {
    throw new HttpError(
      400,
      "IMAGE_TOO_LARGE",
      "Gambar rencana kerja maksimal 8 MB",
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType =
    detectWorkPlanImageMimeType(buffer) ??
    normalizeWorkPlanImageMimeType(file.type);
  if (!mimeType) {
    throw new HttpError(
      400,
      "INVALID_IMAGE_TYPE",
      "Gambar rencana kerja harus JPEG, PNG, atau WebP",
    );
  }
  return extractWorkPlanFromImage(buffer, mimeType);
}
