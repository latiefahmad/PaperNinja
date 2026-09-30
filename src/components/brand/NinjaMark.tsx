import ninjaPng from '@/assets/paper-ninja.png';

interface NinjaMarkProps {
  /** Kept for API compatibility with the old vector mark; the PNG is used for both. */
  variant?: 'full' | 'simple';
  className?: string;
  title?: string;
}

/**
 * The PaperNinja mark — full-colour ninja cat PNG.
 *
 * The old OtterMark was a single-path vector using `currentColor`, which worked
 * because the otter artwork was black-on-white line art suitable for potrace.
 * The ninja artwork is full-colour (black hood, orange/grey face, red belt),
 * so a single-path trace would destroy it. Render the PNG directly instead.
 */
export function NinjaMark({ className, title }: NinjaMarkProps) {
  return (
    <img
      src={ninjaPng}
      className={className}
      alt={title ?? 'PaperNinja'}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      draggable={false}
    />
  );
}
