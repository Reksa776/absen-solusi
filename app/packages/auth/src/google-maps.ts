import { HttpError } from "./http.js";

const ALLOWED_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "google.co.id",
  "www.google.co.id",
  "maps.google.co.id",
  "maps.app.goo.gl",
  "goo.gl",
]);

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const MAX_URL_LENGTH = 1024;
const MAX_REDIRECTS = 5;
const COORDINATE = "(-?\\d{1,3}(?:\\.\\d+)?)";

export type MapsCoordinates = { latitude: number; longitude: number };

function coordinates(latText: string, lngText: string): MapsCoordinates | null {
  const latitude = Number(latText);
  const longitude = Number(lngText);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }
  return { latitude, longitude };
}

function coordinatePattern(prefix: string): RegExp {
  return new RegExp(`${prefix}${COORDINATE},${COORDINATE}`, "i");
}

/**
 * Mendukung shareloc WA yang umum dipakai di lapangan:
 * ?q=lat,lng, @lat,lng,17z, !3dlat!4dlng, ll=, destination=.
 * Parser murni agar dapat diuji tanpa memanggil jaringan.
 */
export function parseGoogleMapsCoordinates(value: string): MapsCoordinates | null {
  const text = value.trim();
  if (!text) return null;
  const patterns = [
    coordinatePattern("[?&](?:q|query|ll)="),
    coordinatePattern("@"),
    coordinatePattern("!3d(?=[^!]*!4d)"),
    coordinatePattern("[?&]destination="),
    new RegExp(`^${COORDINATE}\\s*,\\s*${COORDINATE}$`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    // Pola !3d...!4d membutuhkan pasangan khusus; lihat cabang di bawah.
    if (pattern.source.startsWith("!3d")) continue;
    const parsed = coordinates(match[1] ?? "", match[2] ?? "");
    if (parsed) return parsed;
  }
  const pin = text.match(
    new RegExp(`!3d${COORDINATE}!4d${COORDINATE}`, "i"),
  );
  if (pin) {
    return coordinates(pin[1] ?? "", pin[2] ?? "");
  }
  return null;
}

function normalizeUrl(value: string): URL {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    throw new HttpError(400, "INVALID_GOOGLE_MAPS_URL", "URL Google Maps tidak valid");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, "INVALID_GOOGLE_MAPS_URL", "URL Google Maps tidak valid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "INVALID_GOOGLE_MAPS_URL", "URL Google Maps tidak valid");
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new HttpError(
      400,
      "INVALID_GOOGLE_MAPS_URL",
      "Gunakan tautan Google Maps resmi (google.com atau maps.app.goo.gl)",
    );
  }
  return url;
}

/**
 * Resolver shortlink hanya mengikuti redirect ke host Google yang diizinkan.
 * Ini mencegah SSRF lewat tautan shareloc yang dimanipulasi.
 */
export async function resolveGoogleMapsUrl(
  value: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ googleMapsUrl: string; latitude: number; longitude: number }> {
  const original = normalizeUrl(value).toString();
  let current = original;
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const parsed = parseGoogleMapsCoordinates(current);
    if (parsed) {
      return { googleMapsUrl: original, ...parsed };
    }
    const url = normalizeUrl(current);
    if (!SHORT_HOSTS.has(url.hostname.toLowerCase())) break;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "AbsensiMapsResolver/1.0" },
      });
    } catch {
      throw new HttpError(
        400,
        "GOOGLE_MAPS_RESOLVE_FAILED",
        "Shortlink Google Maps tidak dapat dibuka. Tempel tautan lokasi lengkap.",
      );
    } finally {
      clearTimeout(timer);
    }
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) break;
    current = new URL(location, current).toString();
  }

  throw new HttpError(
    400,
    "INVALID_GOOGLE_MAPS_URL",
    "Koordinat tidak ditemukan pada tautan Google Maps",
  );
}
