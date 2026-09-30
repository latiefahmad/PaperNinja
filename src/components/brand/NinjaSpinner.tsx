import { NinjaMark } from './NinjaMark';

interface NinjaSpinnerProps {
  /** Tailwind size classes. Defaults to 20px, which is where the mark still reads. */
  className?: string;
}

/**
 * The loader at control size: inside a button, beside a label, over a preview.
 *
 * Same keyframe as `NinjaLoader`, deliberately: this is the same animation at a
 * different size, not a second one. That also means it inherits the compositor
 * -only transform and the reduced-motion rule for free.
 */
export function NinjaSpinner({ className }: NinjaSpinnerProps) {
  return (
    <span className="ninja-loader-stage inline-flex flex-none" aria-hidden="true">
      <NinjaMark variant="simple" className={`ninja-loader-mark ${className ?? "size-5"}`} />
    </span>
  );
}
