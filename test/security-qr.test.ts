import { afterEach, describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import { decodeSecurityQrFile } from "../src/core/security-qr.js";

vi.mock("jsqr", () => ({
  default: vi.fn(() => ({
    data: "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP",
  })),
}));

const previousBitmap = Object.getOwnPropertyDescriptor(
  window,
  "createImageBitmap",
);
afterEach(() => {
  vi.restoreAllMocks();
  if (previousBitmap)
    Object.defineProperty(window, "createImageBitmap", previousBitmap);
  else Reflect.deleteProperty(window, "createImageBitmap");
});

describe("local security QR import", () => {
  it("rejects unsupported and oversized inputs before decoding", async () => {
    await expect(
      decodeSecurityQrFile(
        new File(["x"], "secret.txt", { type: "text/plain" }),
      ),
    ).rejects.toThrow("Choose a PNG");
    const huge = new File(["x"], "secret.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 8 * 1024 * 1024 + 1 });
    await expect(decodeSecurityQrFile(huge)).rejects.toThrow("Choose a PNG");
    expect(jsQR).not.toHaveBeenCalled();
  });

  it("accepts only a TOTP payload and clears decoded image memory", async () => {
    const close = vi.fn();
    Object.defineProperty(window, "createImageBitmap", {
      configurable: true,
      value: vi.fn(async () => ({ width: 21, height: 21, close })),
    });
    const pixels = new Uint8ClampedArray(21 * 21 * 4).fill(255);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }),
    } as unknown as CanvasRenderingContext2D);
    const value = await decodeSecurityQrFile(
      new File(["fixture"], "auth.png", { type: "image/png" }),
    );
    expect(value).toBe("otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP");
    expect(jsQR).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(pixels.every((byte) => byte === 0)).toBe(true);
  });
});
