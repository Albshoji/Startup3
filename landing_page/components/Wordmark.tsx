import { PRODUCT_NAME } from '@/lib/site';

// The product name drawn as a logo: "under" + "code" in the code font + a blinking cursor.
export default function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label={PRODUCT_NAME}>
      <span aria-hidden="true">under</span>
      <span className="wm-code" aria-hidden="true">code</span>
      <span className="wm-cursor" aria-hidden="true">_</span>
    </span>
  );
}
