<script lang="ts">
  import {identity} from "ramda"
  import {pubkey} from "@welshman/app"
  import Calendar from "src/app/shared/Calendar.svelte"
  import {env, loadGroupMessages, userFollows} from "src/engine"

  const filter = env.FORCE_GROUP
    ? {kinds: [31923], "#a": [env.FORCE_GROUP]}
    : {kinds: [31923], authors: [$pubkey, ...$userFollows].filter(identity)}

  if (env.FORCE_GROUP) {
    loadGroupMessages([env.FORCE_GROUP])
  }
</script>

<Calendar {filter} />
