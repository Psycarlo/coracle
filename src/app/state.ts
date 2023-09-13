import Bugsnag from "@bugsnag/js"
import {nip19} from "nostr-tools"
import {navigate} from "svelte-routing"
import {writable} from "svelte/store"
import {path, filter, pluck, sortBy, slice} from "ramda"
import {hash, union, sleep, doPipe} from "hurdak"
import {warn} from "src/util/logger"
import {now} from "src/util/misc"
import {userKinds, noteKinds} from "src/util/nostr"
import {modal, toast} from "src/partials/state"
import type {Event} from "src/engine2"
import {
  env,
  pool,
  session,
  loadDeletes,
  loadPubkeys,
  channels,
  follows,
  subscribe,
  getUserRelayUrls,
  getSetting,
  dufflepud,
  events,
} from "src/engine2"

// Routing

export const routes = {
  person: (pubkey: string) => `/people/${nip19.npubEncode(pubkey)}`,
}

export const addToList = (type: string, value: string) =>
  modal.push({type: "list/select", item: {type, value}})

// Menu

export const menuIsOpen = writable(false)

// Redact long strings, especially hex and bech32 keys which are 64 and 63
// characters long, respectively. Put the threshold a little lower in case
// someone accidentally enters a key with the last few digits missing
const redactErrorInfo = (info: any) =>
  JSON.parse(JSON.stringify(info || null).replace(/\w{60}\w+/g, "[REDACTED]"))

// Wait for bugsnag to be started in main
setTimeout(() => {
  Bugsnag.addOnError((event: any) => {
    if (window.location.host.startsWith("localhost")) {
      return false
    }

    if (!getSetting("report_analytics")) {
      return false
    }

    // Redact individual properties since the event needs to be
    // mutated, and we don't want to lose the prototype
    event.context = redactErrorInfo(event.context)
    event.request = redactErrorInfo(event.request)
    event.exceptions = redactErrorInfo(event.exceptions)
    event.breadcrumbs = redactErrorInfo(event.breadcrumbs)

    event.setUser(session)

    return true
  })
})

const sessionId = Math.random().toString().slice(2)

export const logUsage = async (name: string) => {
  // Hash the user's pubkey so we can identify unique users without knowing
  // anything about them
  const pubkey = session.get()?.pubkey
  const ident = pubkey ? hash(pubkey) : "unknown"

  if (getSetting("report_analytics")) {
    try {
      await fetch(dufflepud(`usage/${ident}/${sessionId}/${name}`), {method: "post"})
    } catch (e) {
      if (!e.toString().includes("Failed to fetch")) {
        warn(e)
      }
    }
  }
}

export const slowConnections = writable([])

setInterval(() => {
  // Only notify about relays the user is actually subscribed to
  const userRelays = new Set(getUserRelayUrls())
  const $slowConnections = []

  // Prune connections we haven't used in a while, clear errors periodically,
  // and keep track of slow connections
  for (const [url, connection] of pool.data.entries()) {
    if (connection.meta.last_activity < now() - 60) {
      connection.disconnect()
    } else if (connection.lastError < Date.now() - 10_000) {
      connection.clearError()
    } else if (userRelays.has(url) && connection.meta.quality < 0.3) {
      $slowConnections.push(url)
    }
  }

  // Alert the user to any heinously slow connections
  slowConnections.set($slowConnections)
}, 10_000)

// Synchronization from events to state

let listener
let timeout

export const listenForNotifications = async () => {
  const {pubkey} = session.get()
  const channelIds = pluck("id", channels.get().filter(path(["nip28", "joined"])))

  const eventIds: string[] = doPipe(events.get(), [
    filter((e: Event) => noteKinds.includes(e.kind)),
    sortBy((e: Event) => -e.created_at),
    slice(0, 256),
    pluck("id"),
  ])

  // Only grab one event from each category/relay so we have enough to show
  // the notification badges, but load the details lazily
  listener?.close()
  listener = subscribe({
    relays: getUserRelayUrls("read"),
    filters: [
      // Messages
      {kinds: [4], authors: [pubkey], limit: 1},
      {kinds: [4], "#p": [pubkey], limit: 1},
      // {kinds: [1059], "#p": [pubkey], limit: 1},
      // Chat
      {kinds: [42], "#e": channelIds, limit: 1},
      // Mentions/replies
      {kinds: noteKinds, "#p": [pubkey], limit: 1},
      {kinds: noteKinds, "#e": eventIds, limit: 1},
    ],
  })

  clearTimeout(timeout)

  timeout = setTimeout(listenForNotifications, 3 * 60_000)
}

export const loadAppData = async () => {
  const {pubkey} = session.get()

  // Make sure the user and their follows are loaded
  await loadPubkeys([pubkey], {force: true, kinds: userKinds})

  // Load deletes
  loadDeletes()

  // Load their network
  loadPubkeys(follows.get())

  // Start our listener
  listenForNotifications()
}

export const boot = async () => {
  if (env.get().FORCE_RELAYS.length > 0) {
    modal.replace({
      type: "message",
      message: "Logging you in...",
      spinner: true,
      noEscape: true,
    })

    await Promise.all([
      sleep(1500),
      loadPubkeys([session.get().pubkey], {force: true, kinds: userKinds}),
    ])

    navigate("/notes")
  } else {
    modal.push({type: "login/connect", noEscape: true})
  }
}

export const toastProgress = progress => {
  const {event, succeeded, failed, timeouts, completed, pending} = progress
  const relays = Array.from(union(completed, pending))

  let message = `Published to ${succeeded.size}/${relays.length} relays`

  const extra = []
  if (failed.size > 0) {
    extra.push(`${failed.size} failed`)
  }

  if (timeouts.size > 0) {
    extra.push(`${timeouts.size} timed out`)
  }

  if (pending.size > 0) {
    extra.push(`${pending.size} pending`)
  }

  if (extra.length > 0) {
    message += ` (${extra.join(", ")})`
  }

  const payload = pending.size
    ? message
    : {
        text: message,
        link: {
          text: "Details",
          onClick: () => modal.push({type: "publish/info", event, progress, relays}),
        },
      }

  toast.show("info", payload, pending.size ? null : 8)
}
