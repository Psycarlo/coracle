<script lang="ts">
  import {
    Scope,
    feedFromFilter,
    makeIntersectionFeed,
    makeKindFeed,
    makeScopeFeed,
  } from "@welshman/feeds"
  import {signer} from "@welshman/app"
  import Card from "src/partials/Card.svelte"
  import Anchor from "src/partials/Anchor.svelte"
  import Feed from "src/app/shared/Feed.svelte"
  import {router} from "src/app/util/router"
  import {env, loadGroupMessages} from "src/engine"
  import {makeFeed} from "src/domain"

  const feed = makeFeed({
    definition: env.FORCE_GROUP
      ? feedFromFilter({kinds: [30402], "#a": [env.FORCE_GROUP]})
      : makeIntersectionFeed(makeKindFeed(30402), makeScopeFeed(Scope.Self, Scope.Follows)),
  })

  const createListing = () => router.at("notes/create").qp({type: "listing"}).open()

  if (env.FORCE_GROUP) {
    loadGroupMessages([env.FORCE_GROUP])
  }
</script>

{#if $signer}
  <Card class="flex justify-between">
    Have something you'd like to sell on nostr?
    <Anchor button accent on:click={createListing}>Create a listing</Anchor>
  </Card>
{/if}

<Feed {feed} />
