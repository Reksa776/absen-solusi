import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Proxy/middleware Next.js memotong body request di 10 MB. Unggahan APK di
    // panel Admin mencapai 300 MB, jadi batasnya dinaikkan agar FormData utuh.
    // Next 16.4 menolak `middlewareClientMaxBodySize` (alias lama) bila diisi
    // bersama opsi ini, jadi hanya `proxyClientMaxBodySize` yang dipakai.
    proxyClientMaxBodySize: "300mb",
    serverActions: { bodySizeLimit: "300mb" },
  },
};

export default nextConfig;
