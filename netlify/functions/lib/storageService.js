const { randomUUID } = require("crypto");

const ALLOWED_IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

// upload: multer file object ({ buffer, mimetype, originalname })
// bucket: Supabase Storage bucket name
// prefix: filename prefix, e.g. `product_${id}` or `custom`
async function storeImage({ upload, bucket, prefix, supabase }) {
  const extension = ALLOWED_IMAGE_TYPES[upload.mimetype];
  if (!extension) throw new Error("Choose a JPG, PNG, WEBP, or GIF image.");
  const filename = `${prefix}_${randomUUID()}${extension}`;

  const { error } = await supabase.storage.from(bucket).upload(filename, upload.buffer, {
    contentType: upload.mimetype,
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return { url: data.publicUrl, filename };
}

async function removeImage({ bucket, filename, supabase }) {
  if (!filename) return;
  const { error } = await supabase.storage.from(bucket).remove([filename]);
  if (error) throw error;
}

async function removeImagesByPrefix({ bucket, prefix, supabase }) {
  const { data, error } = await supabase.storage.from(bucket).list('', { search: prefix, limit: 1000 });
  if (error) throw error;
  const filenames = (data || []).map((file) => file.name).filter((name) => name.startsWith(prefix));
  if (filenames.length) {
    const result = await supabase.storage.from(bucket).remove(filenames);
    if (result.error) throw result.error;
  }
}

module.exports = { ALLOWED_IMAGE_TYPES, storeImage, removeImage, removeImagesByPrefix };
