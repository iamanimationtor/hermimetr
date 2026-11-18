// Conservative limits below Netlify Functions' buffered request ceiling, including
// multipart metadata and base64/JSON encoding overhead.
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_PRICEBOOK_FILE_BYTES = 2_800_000;
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
