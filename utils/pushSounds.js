// The notification sounds an admin may pick from.
//
// IMPORTANT: the server only sends the *name* of a sound. The audio file itself has to
// ship inside the mobile app, or the device falls back to the default tone:
//
//   Android  android/app/src/main/res/raw/<id>.mp3   (lowercase, no spaces/hyphens)
//   iOS      bundled in the app, <= 30s, e.g. <id>.caf / .aiff / .wav
//
// Android 8+ takes the sound from the notification *channel*, not from the message, so
// the app must also create one channel per sound using `channelId` below. Without that
// channel a modern Android device plays the default tone no matter what is sent here.
//
// Adding a sound here without adding the file (and channel) to the app is harmless --
// it simply plays the default tone.
export const PUSH_SOUNDS = [
  { id: "default", label: "Default (system tone)", channelId: "default", iosFile: "default" },
  { id: "chime", label: "Chime", channelId: "sound_chime", iosFile: "chime.caf" },
  { id: "ding", label: "Ding", channelId: "sound_ding", iosFile: "ding.caf" },
  { id: "cash", label: "Cash register (offers)", channelId: "sound_cash", iosFile: "cash.caf" },
  { id: "alert", label: "Alert", channelId: "sound_alert", iosFile: "alert.caf" },
  { id: "silent", label: "Silent (no sound)", channelId: "sound_silent", iosFile: "" },
]

const byId = new Map(PUSH_SOUNDS.map((sound) => [sound.id, sound]))

export const DEFAULT_PUSH_SOUND = "default"

/** A known sound id, or the default. Never trusts whatever the client sent. */
export const normalizePushSound = (value) => {
  const id = String(value || "").trim().toLowerCase()
  return byId.has(id) ? id : DEFAULT_PUSH_SOUND
}

export const getPushSound = (value) => byId.get(normalizePushSound(value)) || byId.get(DEFAULT_PUSH_SOUND)
