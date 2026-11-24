const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_TIMEOUT_MS = 3_500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_LIMIT = 500;
const USER_AGENT =
  "AbsensiHRIS/1.0 (+https://absensi.local; contact@absensi.local)";

type CachedAddress = {
  address: string;
  expiresAt: number;
};

type NominatimResponse = {
  display_name?: unknown;
  address?: Record<string, unknown>;
};

export type ReverseGeocodeOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
};

const cache = new Map<string, CachedAddress>();
const inFlight = new Map<string, Promise<string>>();

export function coordinateAddress(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function reverseGeocodeCacheKey(
  latitude: number,
  longitude: number,
): string {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

export function clearReverseGeocodeCache(): void {
  cache.clear();
  inFlight.clear();
}

function textPart(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatNominatimAddress(data: NominatimResponse): string | null {
  const displayName = textPart(data.display_name);
  if (displayName) return displayName;

  const address = data.address ?? {};
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = textPart(address[key]);
      if (value) return value;
    }
    return "";
  };
  const parts = [
    pick("road", "pedestrian", "footway", "path"),
    pick("village", "suburb", "neighbourhood", "hamlet"),
    pick("city_district", "district", "county"),
    pick("city", "town", "municipality"),
    pick("state"),
    pick("postcode"),
    pick("country"),
  ].filter((part) => part !== "");
  if (parts.length === 0) return null;
  return [...new Set(parts)].join(", ");
}

async function requestAddress(
  baseUrl: string,
  latitude: number,
  longitude: number,
  options: ReverseGeocodeOptions,
): Promise<string | null> {
  const endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/reverse`);
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("lat", String(latitude));
  endpoint.searchParams.set("lon", String(longitude));
  endpoint.searchParams.set("accept-language", "id");
  endpoint.searchParams.set("addressdetails", "1");

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      headers: {
        accept: "application/json",
        "user-agent": process.env.NOMINATIM_USER_AGENT?.trim() || USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as NominatimResponse;
    return formatNominatimAddress(data);
  } finally {
    clearTimeout(timer);
  }
}

function remember(key: string, address: string): void {
  cache.delete(key);
  cache.set(key, { address, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Reverse geocoding Nominatim dengan cache 5 desimal (~1,1 m) dan timeout
 * singkat. Kegagalan jaringan tidak pernah menggagalkan transaksi utama:
 * hasil fallback adalah string koordinat 6 desimal.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  options: ReverseGeocodeOptions = {},
): Promise<string | null> {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  const fallback = coordinateAddress(latitude, longitude);
  const key = reverseGeocodeCacheKey(latitude, longitude);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.address;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const configuredBaseUrl =
    options.baseUrl?.trim() || process.env.NOMINATIM_BASE_URL?.trim() || "";
  // Suite test mematikan jaringan eksternal; test yang peduli alamat
  // mengarahkan NOMINATIM_BASE_URL ke stub lokal.
  if (
    !configuredBaseUrl &&
    !options.fetchImpl &&
    process.env.GEOCODING_DISABLED === "1"
  ) {
    return fallback;
  }

  const task = requestAddress(
    configuredBaseUrl || DEFAULT_BASE_URL,
    latitude,
    longitude,
    options,
  )
    .then((address) => {
      if (!address) return fallback;
      remember(key, address);
      return address;
    })
    .catch(() => fallback);

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
