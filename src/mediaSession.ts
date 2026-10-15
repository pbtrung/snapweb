import { SnapControl } from './snapcontrol';
import snapcast512 from './assets/snapcast-512.png';

// Seconds to skip when the platform doesn't say how far
const DEFAULT_SKIP_SECONDS = 10;

function setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Not every browser supports every action, e.g. "stop" or "seekto"
  }
}

const ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
];

// Take Snapweb out of the platform's media controls once it stops playing
export function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  for (const action of ACTIONS) setActionHandler(action, null);
}

// Mirror a stream's metadata, playback state and controls in the platform's
// media controls (lock screen, notification, media keys).
// https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
export function updateMediaSession(snapControl: SnapControl, streamId: string, audio: HTMLAudioElement) {
  if (!('mediaSession' in navigator)) return;
  const properties = snapControl.getStream(streamId).properties;
  const metadata = properties.metadata;
  const mediaSession = navigator.mediaSession;

  const artUrl = metadata?.artUrl;
  mediaSession.metadata = new MediaMetadata({
    title: metadata?.getTitle() ?? 'Unknown Title',
    artist: metadata?.getArtist() ?? 'Unknown Artist',
    album: metadata?.album || '',
    // The cover's format and size are unknown, so let the browser find out
    artwork: artUrl ? [{ src: artUrl }] : [{ src: snapcast512, sizes: '512x512', type: 'image/png' }],
  });

  // Snapweb plays silence through this element, which keeps the page's media
  // session active, so follow the stream's playback state with it
  if (properties.playbackStatus === 'playing') {
    audio.play().catch((e) => console.warn('Failed to resume the media session audio: ' + e));
    mediaSession.playbackState = 'playing';
  } else if (properties.playbackStatus === 'paused') {
    audio.pause();
    mediaSession.playbackState = 'paused';
  } else {
    if (properties.playbackStatus === 'stopped') audio.pause();
    mediaSession.playbackState = 'none';
  }

  const control = (command: string, params?: Record<string, unknown>) => () =>
    snapControl.control(streamId, command, params);
  setActionHandler('play', properties.canPlay ? control('play') : null);
  setActionHandler('pause', properties.canPause ? control('pause') : null);
  setActionHandler('previoustrack', properties.canGoPrevious ? control('previous') : null);
  setActionHandler('nexttrack', properties.canGoNext ? control('next') : null);
  setActionHandler('stop', properties.canControl ? control('stop') : null);
  setActionHandler(
    'seekbackward',
    properties.canSeek
      ? (event) => snapControl.control(streamId, 'seek', { offset: -(event.seekOffset || DEFAULT_SKIP_SECONDS) })
      : null,
  );
  setActionHandler(
    'seekforward',
    properties.canSeek
      ? (event) => snapControl.control(streamId, 'seek', { offset: event.seekOffset || DEFAULT_SKIP_SECONDS })
      : null,
  );
  setActionHandler(
    'seekto',
    properties.canSeek
      ? (event) => snapControl.control(streamId, 'setPosition', { position: event.seekTime || 0 })
      : null,
  );

  if (!('setPositionState' in mediaSession)) return;
  const duration = metadata?.duration;
  const position = properties.position;
  if (duration !== undefined && position !== undefined && position <= duration)
    mediaSession.setPositionState({ duration, playbackRate: 1.0, position });
  else mediaSession.setPositionState({ duration: 0, playbackRate: 1.0, position: 0 });
}
