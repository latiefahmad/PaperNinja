import { Heart } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { t } from '@/i18n';

const SAWERIA_URL = 'https://saweria.co/latiefahmad';

// Saweria has no widget that can be embedded without a remote <script>, and
// loading one would break the app's CSP. So the button is drawn here, and the
// click opens their page in a browser tab instead.
export function SaweriaButton() {
  return (
    <button
      type="button"
      onClick={() => openUrl(SAWERIA_URL).catch(() => {})}
      className="inline-flex items-center gap-1.5 border-2 border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground [border-radius:12px_5px_14px_6px_/_6px_14px_5px_12px] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      title={t('support.viaSaweria')}
    >
      <Heart className="h-3.5 w-3.5 fill-primary text-primary" />
      <span>{t('saweriaButton.support')}</span>
    </button>
  );
}
