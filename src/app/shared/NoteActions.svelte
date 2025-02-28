<script lang="ts">
  import cx from "classnames"
  import {nip19} from "nostr-tools"
  import {onMount} from "svelte"
  import {derived} from "svelte/store"
  import {ctx, remove, last, sortBy} from "@welshman/lib"
  import {repository, signer, trackerStore} from "@welshman/app"
  import type {TrustedEvent, SignedEvent} from "@welshman/util"
  import {
    LOCAL_RELAY_URL,
    toNostrURI,
    asSignedEvent,
    isSignedEvent,
    Tags,
    createEvent,
  } from "@welshman/util"
  import {tweened} from "svelte/motion"
  import {identity, sum, uniqBy, prop, pluck} from "ramda"
  import {fly} from "src/util/transition"
  import {formatSats} from "src/util/misc"
  import {quantify, pluralize} from "hurdak"
  import {browser} from "src/partials/state"
  import {showInfo} from "src/partials/Toast.svelte"
  import Icon from "src/partials/Icon.svelte"
  import Anchor from "src/partials/Anchor.svelte"
  import WotScore from "src/partials/WotScore.svelte"
  import Popover from "src/partials/Popover.svelte"
  import ImageCircle from "src/partials/ImageCircle.svelte"
  import Menu from "src/partials/Menu.svelte"
  import MenuItem from "src/partials/MenuItem.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import Heading from "src/partials/Heading.svelte"
  import Modal from "src/partials/Modal.svelte"
  import OverflowMenu from "src/partials/OverflowMenu.svelte"
  import CopyValue from "src/partials/CopyValue.svelte"
  import PersonBadge from "src/app/shared/PersonBadge.svelte"
  import HandlerCard from "src/app/shared/HandlerCard.svelte"
  import RelayCard from "src/app/shared/RelayCard.svelte"
  import GroupSummary from "src/app/shared/GroupSummary.svelte"
  import {router} from "src/app/util/router"
  import {
    env,
    groups,
    publish,
    makeZapSplit,
    mention,
    mentionEvent,
    unmuteNote,
    muteNote,
    deriveHandlersForKind,
    userIsGroupMember,
    publishToZeroOrMoreGroups,
    deleteEvent,
    getSetting,
    loadPubkeys,
    getReactionTags,
    getClientTags,
    sessionWithMeta,
  } from "src/engine"
  import {getHandlerKey, readHandlers, displayHandler} from "src/domain"

  export let note: TrustedEvent
  export let muted
  export let replyCtrl
  export let showHidden
  export let addToContext
  export let contextAddress
  export let removeFromContext
  export let replies, likes, zaps
  export let zapper

  const tags = Tags.fromEvent(note)
  const signedEvent = asSignedEvent(note as any)
  const address = contextAddress || tags.context().values().first()
  const addresses = [address].filter(identity)
  const nevent = nip19.neventEncode({id: note.id, relays: ctx.app.router.Event(note).getUrls()})
  const interpolate = (a, b) => t => a + Math.round((b - a) * t)
  const mentions = tags.values("p").valueOf()
  const likesCount = tweened(0, {interpolate})
  const zapsTotal = tweened(0, {interpolate})
  const repliesCount = tweened(0, {interpolate})
  const kindHandlers = deriveHandlersForKind(note.kind)
  const handlerId = tags.get("client")?.nth(2)
  const handlerEvent = handlerId ? repository.getEvent(handlerId) : null
  const noteActions = getSetting("note_actions")
  const seenOn = derived(trackerStore, $t =>
    remove(LOCAL_RELAY_URL, Array.from($t.getRelays(note.id))),
  )

  const setView = v => {
    view = v
  }

  const showHandlers = () => {
    handlersShown = true
  }

  const hideHandlers = () => {
    handlersShown = false
  }

  const os = browser.os?.name?.toLowerCase()

  const createLabel = () => router.at("notes").of(note.id).at("label").open()

  const quote = () => router.at("notes/create").cx({quote: note, group: address}).open()

  const report = () => router.at("notes").of(note.id).at("report").open()

  const deleteNote = () => router.at("notes").of(note.id).at("delete").qp({kind: note.kind}).open()

  const react = async content => {
    if (isSignedEvent(note)) {
      publish({event: note, relays: ctx.app.router.PublishEvent(note).getUrls()})
    }

    const tags = [...getReactionTags(note), ...getClientTags()]
    const template = createEvent(7, {content, tags})
    const {events} = await publishToZeroOrMoreGroups(addresses, template)

    for (const event of events) {
      addToContext(event)
    }
  }

  const deleteReaction = e => {
    deleteEvent(e)
    removeFromContext(e)
  }

  const crossPost = async (address = null) => {
    const content = JSON.stringify(note as SignedEvent)
    const tags = [...mentionEvent(note), mention(note.pubkey), ...getClientTags()]

    let template
    if (note.kind === 1) {
      template = createEvent(6, {content, tags})
    } else {
      template = createEvent(16, {content, tags: [...tags, ["k", String(note.kind)]]})
    }

    publishToZeroOrMoreGroups(addresses, template)

    showInfo("Note has been cross-posted!")

    setView(null)
  }

  const startZap = () => {
    const zapTags = tags.whereKey("zap")
    const defaultSplit = makeZapSplit(note.pubkey)
    const splits = zapTags.exists() ? zapTags.unwrap() : [defaultSplit]

    router
      .at("zap")
      .qp({
        splits,
        id: note.id,
        anonymous: Boolean(note.wrap),
      })
      .cx({callback: addToContext})
      .open()
  }

  const broadcast = () => {
    publish({
      event: asSignedEvent(note as SignedEvent),
      relays: ctx.app.router.WriteRelays().getUrls(),
    })

    showInfo("Note has been re-published!")
  }

  const openWithHandler = handler => {
    const [templateTag] = sortBy((t: string[]) => {
      if (t[0] === "web" && last(t) === "nevent") return -6
      if (t[0] === "web" && last(t) === "note") return -5
      if (t[0] === "web" && t.length === 2) return -4
      if (t[0] === os && last(t) === "nevent") return -3
      if (t[0] === os && last(t) === "note") return -2
      if (t[0] === os && t.length === 2) return -1

      return 0
    }, handler.event.tags)

    const entity =
      last(templateTag) === "note"
        ? nip19.noteEncode(note.id)
        : nip19.neventEncode({id: note.id, relays: ctx.app.router.Event(note).getUrls()})

    window.open(templateTag[1].replace("<bech32>", entity))
  }

  const groupOptions = derived(sessionWithMeta, $sessionWithMeta => {
    const options = []

    for (const addr of Object.keys($sessionWithMeta?.groups || {})) {
      const group = groups.key(addr).get()
      const isMember = $userIsGroupMember(addr)

      if (group && isMember && addr !== address) {
        options.push(group)
      }
    }

    return uniqBy(prop("address"), options)
  })

  let view
  let actions = []
  let handlersShown = false

  $: disableActions =
    !$signer || (muted && !showHidden) || (note.wrap && address && !$userIsGroupMember(address))
  $: like = likes.find(e => e.pubkey === $sessionWithMeta?.pubkey)
  $: $likesCount = likes.length
  $: zap = zaps.find(e => e.request.pubkey === $sessionWithMeta?.pubkey)
  $: $zapsTotal = sum(pluck("invoiceAmount", zaps)) / 1000
  $: canZap = zapper?.allowsNostr && note.pubkey !== $sessionWithMeta?.pubkey
  $: reply = replies.find(e => e.pubkey === $sessionWithMeta?.pubkey)
  $: $repliesCount = replies.length
  $: handlers = $kindHandlers.filter(
    h =>
      h.name.toLowerCase() !== "coracle" &&
      h.event.tags.some(
        t => ["web", os].includes(t[0]) && (t.length == 2 || ["note", "nevent"].includes(last(t))),
      ),
  )

  $: {
    actions = []

    if ($signer) {
      actions.push({label: "Quote", icon: "quote-left", onClick: quote})

      if (isSignedEvent(note) && !env.FORCE_GROUP && ($groupOptions.length > 0 || address)) {
        actions.push({label: "Cross-post", icon: "shuffle", onClick: () => setView("cross-post")})
      }

      actions.push({label: "Tag", icon: "tag", onClick: createLabel})

      if (muted) {
        actions.push({label: "Unmute", icon: "microphone", onClick: () => unmuteNote(note.id)})
      } else {
        actions.push({label: "Mute", icon: "microphone-slash", onClick: () => muteNote(note.id)})
      }

      actions.push({label: "Report", icon: "triangle-exclamation", onClick: report})
    }

    if (!env.FORCE_GROUP && env.PLATFORM_RELAYS.length === 0 && isSignedEvent(note)) {
      actions.push({label: "Broadcast", icon: "rss", onClick: broadcast})
    }

    if (note.pubkey === $sessionWithMeta?.pubkey) {
      actions.push({
        label: "Delete",
        icon: "trash",
        onClick: deleteNote,
      })
    }

    actions.push({
      label: "Details",
      icon: "info",
      onClick: () => setView("info"),
    })
  }

  onMount(() => {
    loadPubkeys(tags.whereKey("zap").values().valueOf())
  })
</script>

<button
  tabindex="-1"
  type="button"
  class="flex justify-between text-neutral-100"
  on:click|stopPropagation>
  <div class="flex gap-8 text-sm">
    <button
      class={cx("relative flex items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0", {
        "pointer-events-none opacity-50": disableActions,
      })}
      on:click={replyCtrl?.start}>
      <Icon icon="message" color={reply ? "accent" : "neutral-100"} />
      {#if $repliesCount > 0 && noteActions.includes("replies")}
        <span transition:fly|local={{y: 5, duration: 100}} class="-mt-px">{$repliesCount}</span>
      {/if}
    </button>
    {#if env.ENABLE_ZAPS && noteActions.includes("zaps")}
      <button
        class={cx("relative flex items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0", {
          "pointer-events-none opacity-50": disableActions || !canZap,
        })}
        on:click={startZap}>
        <Icon icon="bolt" color={zap ? "accent" : "neutral-100"} />
        {#if $zapsTotal > 0}
          <span transition:fly|local={{y: 5, duration: 100}} class="-mt-px"
            >{formatSats($zapsTotal)}</span>
        {/if}
      </button>
    {/if}
    {#if noteActions.includes("reactions")}
      <button
        class={cx("relative flex items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0", {
          "pointer-events-none opacity-50":
            disableActions || note.pubkey === $sessionWithMeta?.pubkey,
        })}
        on:click={() => (like ? deleteReaction(like) : react("+"))}>
        <Icon
          icon="heart"
          color={like ? "accent" : "neutral-100"}
          class={cx("cursor-pointer", {
            "fa-beat fa-beat-custom": like,
          })} />
        {#if $likesCount > 0}
          <span transition:fly|local={{y: 5, duration: 100}} class="-mt-px">{$likesCount}</span>
        {/if}
      </button>
    {/if}
    {#if handlers.length > 0 && noteActions.includes("recommended_apps")}
      <Popover theme="transparent" opts={{hideOnClick: true}}>
        <button
          slot="trigger"
          class="relative flex hidden h-6 items-center gap-1 pt-1 transition-all hover:pb-1 hover:pt-0 sm:block">
          <i class="fa fa-up-right-from-square fa-sm" />
        </button>
        <div slot="tooltip" class="max-h-[300px] min-w-[180px] overflow-auto">
          <Menu>
            <MenuItem inert class="bg-neutral-900">Open with:</MenuItem>
            {#each handlers as handler}
              <MenuItem
                class="flex h-12 items-center justify-between gap-2"
                on:click={() => openWithHandler(handler)}>
                <div class="flex gap-2">
                  <ImageCircle class="h-5 w-5" src={handler.image} />
                  {handler.name}
                </div>
                {#if handler.recommendations.length > 0}
                  <WotScore accent score={handler.recommendations.length} />
                {/if}
              </MenuItem>
            {/each}
          </Menu>
        </div>
      </Popover>
    {/if}
  </div>
  <div class="flex scale-90 items-center gap-2">
    {#if note.wrap}
      <div
        class="staatliches flex h-6 items-center gap-1 rounded bg-neutral-800 px-2 text-neutral-100 transition-colors dark:bg-neutral-600 dark:hover:bg-neutral-500">
        <i class="fa fa-lock text-xs sm:text-accent" />
        <span class="hidden sm:inline">Encrypted</span>
      </div>
    {/if}
    {#if $seenOn?.length > 0 && (env.PLATFORM_RELAYS.length === 0 || env.PLATFORM_RELAYS.length > 1)}
      <div
        class="staatliches hidden cursor-pointer rounded bg-neutral-800 px-2 text-neutral-100 transition-colors hover:bg-neutral-700 dark:bg-neutral-600 dark:hover:bg-neutral-500 sm:block"
        on:click={() => setView("info")}>
        <span class="text-accent">{$seenOn.length}</span>
        {pluralize($seenOn.length, "relay")}
      </div>
    {/if}
    <OverflowMenu {actions} />
  </div>
</button>

{#if view}
  <Modal onEscape={() => setView(null)}>
    {#if view === "info"}
      {#if zaps.length > 0}
        <h1 class="staatliches text-2xl">Zapped By</h1>
        <div class="grid grid-cols-2 gap-2">
          {#each zaps as zap}
            <div class="flex flex-col gap-1">
              <PersonBadge pubkey={zap.request.pubkey} />
              <span class="ml-16 text-sm text-neutral-600"
                >{formatSats(zap.invoiceAmount / 1000)} sats</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if likes.length > 0}
        <h1 class="staatliches text-2xl">Liked By</h1>
        <div class="grid grid-cols-2 gap-2">
          {#each likes as like}
            <PersonBadge pubkey={like.pubkey} />
          {/each}
        </div>
      {/if}
      {#if $seenOn?.length > 0 && (env.PLATFORM_RELAYS.length === 0 || env.PLATFORM_RELAYS.length > 1)}
        <h1 class="staatliches text-2xl">Relays</h1>
        <p>This note was found on {quantify($seenOn.length, "relay")} below.</p>
        <div class="flex flex-col gap-2">
          {#each $seenOn as url}
            <RelayCard {url} />
          {/each}
        </div>
      {/if}
      {#if mentions.length > 0}
        <h1 class="staatliches text-2xl">In this conversation</h1>
        <p>{quantify(mentions.length, "person", "people")} are tagged in this note.</p>
        <div class="grid grid-cols-2 gap-2">
          {#each mentions as pubkey}
            <PersonBadge {pubkey} />
          {/each}
        </div>
      {/if}
      {#if handlers.length > 0 || handlerEvent}
        <h1 class="staatliches text-2xl">Apps</h1>
        {#if handlerEvent}
          {@const [handler] = readHandlers(handlerEvent)}
          {#if handler}
            <p>This note was published using {displayHandler(handler)}.</p>
            <HandlerCard {handler} />
          {/if}
        {/if}
        {#if handlers.length > 0}
          <div class="flex justify-between">
            <p>
              This note can also be viewed using {quantify(handlers.length, "other nostr app")}.
            </p>
            {#if handlersShown}
              <Anchor underline on:click={hideHandlers}>Hide apps</Anchor>
            {:else}
              <Anchor underline on:click={showHandlers}>Show apps</Anchor>
            {/if}
          </div>
          {#if handlersShown}
            <div in:fly={{y: 20}}>
              <FlexColumn>
                {#each handlers as handler (getHandlerKey(handler))}
                  <HandlerCard {handler} />
                {/each}
              </FlexColumn>
            </div>
          {/if}
        {/if}
      {/if}
      <h1 class="staatliches text-2xl">Details</h1>
      <CopyValue label="Link" value={toNostrURI(nevent)} />
      <CopyValue label="Event ID" encode={nip19.noteEncode} value={note.id} />
      <CopyValue label="Event JSON" value={JSON.stringify(signedEvent)} />
    {:else if view === "cross-post"}
      <div class="mb-4 flex items-center justify-center">
        <Heading>Cross-post</Heading>
      </div>
      <div>Select where you'd like to post to:</div>
      <div class="flex flex-col gap-2">
        {#if address}
          <Card invertColors interactive on:click={() => crossPost()}>
            <div class="flex gap-4 text-neutral-100">
              <i class="fa fa-earth-asia fa-2x" />
              <div class="flex min-w-0 flex-grow flex-col gap-4">
                <p class="text-2xl">Global</p>
                <p>Post to your main feed.</p>
              </div>
            </div>
          </Card>
        {/if}
        {#each $groupOptions as g (g.address)}
          <Card invertColors interactive on:click={() => crossPost(g.address)}>
            <GroupSummary address={g.address} />
          </Card>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}
