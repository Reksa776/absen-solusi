import assert from "node:assert/strict";
import test from "node:test";

import {
  clearReverseGeocodeCache,
  reverseGeocodeCoordinates,
} from "./geocoding.js";

test("GEO-1: reverse geocoding memakai display_name dan cache 5 desimal", async () => {
  clearReverseGeocodeCache();
  let calls = 0;
  const fetchImpl = async (
    input: string | Request | URL,
  ): Promise<Response> => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/reverse");
    assert.equal(url.searchParams.get("format"), "jsonv2");
    assert.equal(url.searchParams.get("accept-language"), "id");
    assert.match(url.searchParams.get("lat") ?? "", /^-6\.73200/);
    return new Response(
      JSON.stringify({ display_name: "Jl. Uji No. 1, Kota Uji, Indonesia" }),
      { status: 200 },
    );
  };

  const first = await reverseGeocodeCoordinates(-6.732001, 108.552301, {
    fetchImpl,
  });
  const second = await reverseGeocodeCoordinates(-6.732004, 108.552304, {
    fetchImpl,
  });
  assert.equal(first, "Jl. Uji No. 1, Kota Uji, Indonesia");
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test("GEO-2: komponen alamat disusun saat display_name kosong", async () => {
  clearReverseGeocodeCache();
  const fetchImpl = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        address: {
          road: "Jl. Uji",
          village: "Kelurahan Uji",
          city: "Kota Uji",
          state: "Jawa Tengah",
          postcode: "50123",
          country: "Indonesia",
        },
      }),
      { status: 200 },
    );

  const address = await reverseGeocodeCoordinates(-6.1, 106.2, { fetchImpl });
  assert.equal(
    address,
    "Jl. Uji, Kelurahan Uji, Kota Uji, Jawa Tengah, 50123, Indonesia",
  );
});

test("GEO-3: kegagalan jaringan fallback ke koordinat 6 desimal", async () => {
  clearReverseGeocodeCache();
  const fetchImpl = async (): Promise<Response> => {
    throw new Error("offline");
  };
  const address = await reverseGeocodeCoordinates(-6.1, 106.2, { fetchImpl });
  assert.equal(address, "-6.100000, 106.200000");
});
