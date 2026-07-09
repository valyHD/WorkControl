function navigateToPath(path: string) {
  if (typeof window === "undefined") return;
  window.focus();
  window.location.assign(path);
}

type BrowserNotificationOptions = {
  sound?: boolean;
  tag?: string;
  notificationId?: string;
};

let audioContext: AudioContext | null = null;
const recentNotificationKeys = new Map<string, number>();
const RECENT_NOTIFICATION_TTL_MS = 2 * 60 * 1000;

function cleanNotificationKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 140);
}

function getNotificationKey(title: string, body: string, path: string, options: BrowserNotificationOptions): string {
  return options.notificationId || options.tag || `${title}|${body}|${path}`;
}

function shouldSkipDuplicateNotification(key: string): boolean {
  const now = Date.now();
  const safeKey = cleanNotificationKey(key);

  for (const [existingKey, ts] of recentNotificationKeys.entries()) {
    if (now - ts > RECENT_NOTIFICATION_TTL_MS) {
      recentNotificationKeys.delete(existingKey);
    }
  }

  const previous = recentNotificationKeys.get(safeKey);
  if (previous && now - previous < RECENT_NOTIFICATION_TTL_MS) {
    return true;
  }

  recentNotificationKeys.set(safeKey, now);

  try {
    const storageKey = `wc_notification_seen_${safeKey}`;
    const raw = window.localStorage.getItem(storageKey);
    const previousStored = raw ? Number(raw) : 0;
    if (Number.isFinite(previousStored) && now - previousStored < RECENT_NOTIFICATION_TTL_MS) {
      return true;
    }
    window.localStorage.setItem(storageKey, String(now));
  } catch {
    // Ignore private browsing/storage restrictions.
  }

  return false;
}

async function playNotificationSound() {
  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) return;

  try {
    audioContext = audioContext ?? new AudioContextCtor();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(660, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  } catch (error) {
    console.warn("[NotificationSound]", error);
  }
}

export async function showBrowserNotification(
  title: string,
  body: string,
  path?: string,
  options: BrowserNotificationOptions = {}
) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const destinationPath = path ?? "/notifications";
  const dedupeKey = getNotificationKey(title, body, destinationPath, options);
  if (shouldSkipDuplicateNotification(dedupeKey)) return;

  const notificationTag = options.tag || `workcontrol-${cleanNotificationKey(dedupeKey)}`;
  if (options.sound !== false) {
    void playNotificationSound();
  }

  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();

    if (registration) {
      const notificationOptions: NotificationOptions & { renotify?: boolean } = {
        body,
        silent: options.sound === false,
        tag: notificationTag,
        renotify: false,
        data: {
          path: destinationPath,
          notificationId: options.notificationId || dedupeKey,
        },
      };

      await registration.showNotification(title, notificationOptions);
      return;
    }
  }

  const notification = new Notification(title, {
    body,
    silent: options.sound === false,
    tag: notificationTag,
    data: {
      path: destinationPath,
      notificationId: options.notificationId || dedupeKey,
    },
  });

  notification.onclick = (event) => {
    event.preventDefault();
    navigateToPath(destinationPath);
  };
}
