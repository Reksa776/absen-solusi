import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGoogleMapsCoordinates,
  resolveGoogleMapsUrl,
} from "./google-maps.js";

test("GM-1: format shareloc umum mengekstrak latitude/longitude", () => {
  assert.deepEqual(
    parseGoogleMapsCoordinates(
      "https://www.google.com/maps?q=-6.7320,108.5523",
    ),
    { latitude: -6.732, longitude: 108.5523 },
  );
  assert.deepEqual(
    parseGoogleMapsCoordinates(
      "https://www.google.com/maps/@-6.7320,108.5523,17z",
    ),
    { latitude: -6.732, longitude: 108.5523 },
  );
  assert.deepEqual(
    parseGoogleMapsCoordinates(
      "https://www.google.com/maps/place/Kantor/data=!4m2!3d-6.732!4d108.5523",
    ),
    { latitude: -6.732, longitude: 108.5523 },
  );
  assert.deepEqual(
    parseGoogleMapsCoordinates(
      "https://maps.google.com/?ll=-6.732,108.5523",
    ),
    { latitude: -6.732, longitude: 108.5523 },
  );
});

test("GM-2: shortlink hanya mengikuti redirect Google dan menolak host asing", async () => {
  const calls: string[] = [];
  const resolved = await resolveGoogleMapsUrl(
    "https://maps.app.goo.gl/shareloc",
    {
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://www.google.com/maps?q=-6.7320,108.5523&z=17",
          },
        });
      }) as typeof fetch,
    },
  );
  assert.deepEqual(calls, ["https://maps.app.goo.gl/shareloc"]);
  assert.deepEqual(resolved, {
    googleMapsUrl: "https://maps.app.goo.gl/shareloc",
    latitude: -6.732,
    longitude: 108.5523,
  });

  await assert.rejects(
    resolveGoogleMapsUrl("https://evil.example/maps?q=-6.7,108.5"),
    /Google Maps resmi/,
  );
});
