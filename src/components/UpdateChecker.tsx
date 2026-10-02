import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Sparkles, X } from 'lucide-react';
import { LazyStore } from '@tauri-apps/plugin-store';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { fetchLatestRelease, isNewerVersion, type LatestRelease } from '@/lib/checkForUpdate';
import { t } from '@/i18n';

const store = new LazyStore('paperninja-settings.json');

const DISMISSED_KEY = 'update-dismissed-version';

/**
 * Re-check while the app stays open. A session left running for days would
 * otherwise never learn about a release published after it started.
 */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * One banner, three lives:
 *
 *  - `downloading`: the updater found a newer signed bundle and is fetching it
 *    in the background. Nothing about the app is blocked while this runs.
 *  - `ready`: the bundle is downloaded and its signature verified; the user
 *    picks between restarting now and being asked again at the next launch.
 *  - `fallback`: the updater could not run at all (offline, or the newest
 *    release predates latest.json) — link to the release page, as before.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'fallback'; release: LatestRelease }
  | { kind: 'downloading'; update: Update; percent: number | null }
  | { kind: 'ready'; update: Update };

export function UpdateChecker() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  // The interval callback and the download-event handlers must see the phase
  // as it is now, not as it was when the effect mounted.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    /** The manual path, kept from the pre-updater banner: newest release on
     * GitHub, compared against the running version, opened in the browser. */
    async function fallbackToReleasePage(dismissedVersion: string | undefined) {
      const [{ getVersion }, latest] = await Promise.all([
        import('@tauri-apps/api/app'),
        fetchLatestRelease(),
      ]);
      if (cancelled || !latest) return;
      const currentVersion = await getVersion();
      if (!isNewerVersion(latest.version, currentVersion)) return;
      if (dismissedVersion && !isNewerVersion(latest.version, dismissedVersion)) return;
      setPhase({ kind: 'fallback', release: latest });
    }

    async function checkForUpdate() {
      // One check at a time, and never while a download, a restart prompt or
      // a dismissal is already deciding what the user sees.
      if (cancelled || inFlight || phaseRef.current.kind !== 'idle' || dismissedRef.current) return;
      inFlight = true;
      try {
        const dismissedVersion = await store.get<string>(DISMISSED_KEY).catch(() => undefined);
        if (cancelled) return;

        let update: Update | null;
        try {
          // The plugin fetches latest.json from the endpoint in
          // tauri.conf.json and does the version comparison itself, resolving
          // to null when this build is already current.
          update = await check();
        } catch {
          // The endpoint could not even be asked (offline, or a release that
          // shipped before the updater existed): the release page still works.
          await fallbackToReleasePage(dismissedVersion);
          return;
        }

        if (cancelled) return;
        if (!update) return; // up to date — stay silent

        if (dismissedVersion && !isNewerVersion(update.version, dismissedVersion)) return;

        // Download in the background; the user keeps working meanwhile.
        let downloaded = 0;
        let contentLength: number | null = null;
        setPhase({ kind: 'downloading', update, percent: null });
        try {
          await update.download((event) => {
            if (event.event === 'Started') {
              contentLength = event.data.contentLength ?? null;
            } else if (event.event === 'Progress') {
              downloaded += event.data.chunkLength;
              const percent = contentLength
                ? Math.min(100, Math.round((downloaded / contentLength) * 100))
                : null;
              setPhase({ kind: 'downloading', update, percent });
            }
          });
        } catch {
          // Download failed (network dropped, asset missing). The release
          // page is the manual way out; the next launch retries automatically.
          await fallbackToReleasePage(dismissedVersion);
          return;
        }

        if (cancelled) return;
        // Dismissed while the download ran: that choice stands, and the
        // update simply applies at the next launch instead.
        if (dismissedRef.current) return;
        setPhase({ kind: 'ready', update });
      } finally {
        inFlight = false;
      }
    }

    void checkForUpdate();
    const interval = setInterval(() => void checkForUpdate(), RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (dismissed) return null;

  const dismiss = async (version: string) => {
    setDismissed(true);
    setPhase({ kind: 'idle' });
    try {
      await store.set(DISMISSED_KEY, version);
      await store.save();
    } catch {
      // React state already hid the banner; failing to persist only means it
      // may come back on the next launch.
    }
  };

  const restartNow = async (update: Update) => {
    try {
      // Windows: runs the passive NSIS installer, which closes and restarts
      // the app itself — the relaunch below never gets to run there.
      // macOS and Linux: the bundle is swapped in place, and relaunch brings
      // the new version up.
      await update.install();
      await relaunch();
    } catch {
      // Installation failed; the release page is the manual way out.
      const latest = await fetchLatestRelease();
      if (latest) setPhase({ kind: 'fallback', release: latest });
    }
  };

  const banner = 'flex items-center justify-between px-4 py-2 bg-accent/50 border-b border-border/40';

  if (phase.kind === 'fallback') {
    return (
      <div className={banner}>
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{t('updateChecker.versionAvailable', { version: phase.release.version })}</span>
          <button
            type="button"
            onClick={() => openUrl(phase.release.url).catch(() => {})}
            className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            {t('updateChecker.download')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => void dismiss(phase.release.version)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded shrink-0"
          aria-label={t('updateChecker.dismissUpdateBanner')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (phase.kind === 'downloading') {
    const label =
      phase.percent !== null
        ? t('updateChecker.downloadingProgress', { version: phase.update.version, percent: phase.percent })
        : t('updateChecker.downloading', { version: phase.update.version });
    return (
      <div className={banner}>
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Download className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{label}</span>
        </div>
        <button
          type="button"
          onClick={() => void dismiss(phase.update.version)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded shrink-0"
          aria-label={t('updateChecker.dismissUpdateBanner')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (phase.kind === 'ready') {
    return (
      <div className={banner}>
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{t('updateChecker.updateReady', { version: phase.update.version })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void restartNow(phase.update)}
            className="inline-flex items-center gap-1.5 border-2 border-border bg-card px-2 py-0.5 text-xs font-semibold text-foreground rounded transition-colors hover:border-primary/60"
          >
            <RefreshCw className="h-3 w-3" />
            {t('updateChecker.restartNow')}
          </button>
          <button
            type="button"
            onClick={() => void dismiss(phase.update.version)}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm underline underline-offset-2"
          >
            {t('updateChecker.later')}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
