import { parseTotpInput } from "./security-otp.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 5_000_000;
const IMAGE_TYPE = /^image\/(?:png|jpeg|webp|gif|bmp)$/iu;

/** Decode a user-chosen local image in memory. Never upload or retain the image. */
export async function decodeSecurityQrFile(
  file,
  document = globalThis.document,
) {
  if (
    !file ||
    !IMAGE_TYPE.test(file.type ?? "") ||
    !Number.isFinite(file.size) ||
    file.size < 1 ||
    file.size > MAX_IMAGE_BYTES ||
    !document?.createElement
  )
    throw new TypeError(
      "Choose a PNG, JPEG, WebP, GIF or BMP image under 8 MiB",
    );

  const window = document.defaultView;
  let bitmap;
  let image;
  let objectUrl;
  const canvas = document.createElement("canvas");
  let pixels;
  try {
    if (typeof window?.createImageBitmap === "function") {
      bitmap = await window.createImageBitmap(file);
      image = bitmap;
    } else {
      if (!window?.URL?.createObjectURL || !window?.Image)
        throw new Error("Image decoding is unavailable");
      objectUrl = window.URL.createObjectURL(file);
      image = new window.Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Cannot read the QR image"));
        image.src = objectUrl;
      });
    }
    const width = image.naturalWidth ?? image.width;
    const height = image.naturalHeight ?? image.height;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_PIXELS
    )
      throw new Error("QR image dimensions are unsupported");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("QR image decoding is unavailable");
    context.drawImage(image, 0, 0, width, height);
    pixels = context.getImageData(0, 0, width, height);
    const { default: jsQR } = await import("jsqr");
    const code = jsQR(pixels.data, width, height, {
      inversionAttempts: "attemptBoth",
    });
    if (!code?.data) throw new Error("No TOTP QR code found in the image");
    const value = code.data.trim();
    parseTotpInput(value);
    return value;
  } finally {
    pixels?.data.fill(0);
    canvas.width = 0;
    canvas.height = 0;
    bitmap?.close?.();
    if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    if (image && !bitmap) image.src = "";
  }
}
