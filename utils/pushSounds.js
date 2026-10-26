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
// The channel ids are push_default, push_chime, push_ding, push_cash, push_alert and
// push_silent. They have to match what the app registers character for character.
//
// Adding a sound here without adding the file (and channel) to the app is harmless --
// it simply plays the default tone.
// The channel id must match the channel the Android app creates, exactly. It
// was "sound_chime" here while the app registered "push_chime", so Android
// found no such channel and fell back to the default tone -- which is why the
// right sound played in the foreground, where the app chooses it itself, and
// the wrong one in the background, where the system goes by the channel.
//
// Derived from the id rather than typed out, so the two cannot drift apart
// again one entry at a time.
const channelFor = (id) => `push_${id}`

export const PUSH_SOUNDS = [
  { id: "default", label: "Default (system tone)", channelId: channelFor("default"), iosFile: "default" },
  { id: "chime", label: "Chime", channelId: channelFor("chime"), iosFile: "chime.caf" },
  { id: "ding", label: "Ding", channelId: channelFor("ding"), iosFile: "ding.caf" },
  { id: "cash", label: "Cash register (offers)", channelId: channelFor("cash"), iosFile: "cash.caf" },
  { id: "alert", label: "Alert", channelId: channelFor("alert"), iosFile: "alert.caf" },
  { id: "silent", label: "Silent (no sound)", channelId: channelFor("silent"), iosFile: "" },
]

const byId = new Map(PUSH_SOUNDS.map((sound) => [sound.id, sound]))

export const DEFAULT_PUSH_SOUND = "default"

/** A known sound id, or the default. Never trusts whatever the client sent. */
export const normalizePushSound = (value) => {
  const id = String(value || "").trim().toLowerCase()
  return byId.has(id) ? id : DEFAULT_PUSH_SOUND
}

export const getPushSound = (value) => byId.get(normalizePushSound(value)) || byId.get(DEFAULT_PUSH_SOUND)
