-- Additive: simpan URL shareloc asli tanpa mengubah koordinat/radius lama.
ALTER TABLE `office_locations`
  ADD COLUMN `google_maps_url` VARCHAR(1024) NULL;
