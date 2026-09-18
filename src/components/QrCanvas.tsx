import { useMemo } from "react";
import qrcode from "qrcode-generator";

/**
 * Renders a QR code for the given payload. Pure rendering — the payload is
 * built by the caller and never contains a phone number.
 */
export function QrCanvas({ value, size = 208 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }, [value]);

  return (
    <div
      aria-label="N Connect QR code"
      role="img"
      className="[&>svg]:h-full [&>svg]:w-full [&_path]:fill-ink [&_rect]:fill-transparent"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
