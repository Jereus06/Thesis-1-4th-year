BEGIN;

CREATE TABLE product_photos (
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 1 AND 1048576),
  content_type text NOT NULL DEFAULT 'image/webp' CHECK (content_type = 'image/webp'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (business_id, product_id),
  FOREIGN KEY (business_id, product_id) REFERENCES products(business_id, id) ON DELETE CASCADE
);

COMMIT;
