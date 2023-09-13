import {pluck} from "ramda"
import {batch, seconds} from "hurdak"
import {now} from "src/util/misc"
import {EventKind} from "src/engine2/model"
import {session} from "src/engine2/state"
import {getInboxHints, getUserRelayUrls, getSetting} from "src/engine2/queries"
import {load} from "./load"
import {loadPubkeys} from "./pubkeys"
import {subscribe} from "./subscription"

export function loadAllNip04Messages() {
  const {pubkey} = session.get()
  const since = now() - seconds(90, "day")

  load({
    relays: getUserRelayUrls("read"),
    filters: [
      {kinds: [4], authors: [pubkey], since},
      {kinds: [4], "#p": [pubkey], since},
    ],
    onEvent: batch(1000, events => {
      loadPubkeys(pluck("pubkey", events))
    }),
  })
}

export function listenForNip04Messages(contactPubkey: string) {
  const {pubkey: userPubkey} = session.get()

  return subscribe({
    relays: getInboxHints(getSetting("relay_limit"), [contactPubkey, userPubkey]),
    filters: [
      {kinds: [EventKind.Nip04Message], authors: [userPubkey], "#p": [contactPubkey]},
      {kinds: [EventKind.Nip04Message], authors: [contactPubkey], "#p": [userPubkey]},
    ],
  })
}
