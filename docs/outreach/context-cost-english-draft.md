# I Built an Agent Runtime and Learned That Shorter Context Can Cost More

*This English article was prepared with AI assistance from my Chinese notes about Kiso. The linked design record and implementation are the sources for the technical claims below.*

When I started building Kiso, I thought context management had a simple objective: keep the prompt short. The usual plan seemed reasonable. Once a coding agent's history grew past a threshold, I would remove old, bulky tool results. Later, when it approached the model's context limit, I would summarize the conversation. Fewer input tokens should mean a smaller bill.

That assumption missed the cost of changing a cached prefix. The work that led me to remove Kiso's automatic, threshold-based tool-output pruning also changed how I think about agent state: the history of what happened, the context shown to the model, and the economics of that context are three different things.

## The tempting optimization

A coding agent reads files, runs shell commands, edits code, and checks tests. Its tool results can fill a context window faster than the conversation itself. An old directory listing or test log often has little value several turns later, so replacing it with a short placeholder looks like an easy win.

Suppose a provider has already seen a long, stable prompt prefix over many requests. On a provider with prompt caching, much of that prefix may be billed as a cache read rather than a fresh input. Now remove one old tool result from the middle of the history. Everything after the removal shifts. The request has fewer tokens, but the provider may have to process the changed suffix at the more expensive uncached rate.

The calculation is not simply `tokens removed × input price`. It is closer to:

`immediate cost of invalidating the cached suffix` versus `future savings from carrying fewer tokens`.

Those future savings need enough subsequent requests to pay back the cache break. A long-running session might earn that cost back; a task that ends a few turns later might not. The answer depends on the provider's cache behavior and prices, the position of the removed content, and how many requests remain. A fixed rule such as “prune at 50% of the window” cannot know those things.

In Kiso, I therefore kept the tool-output pruning operation but removed it as a standing automatic trigger in the CLI. It is still useful as a fallback if a summary cannot complete, subject to a break-even decision, and library users can explicitly opt into the older threshold behavior. This is a narrower conclusion than “never delete old context.”

## History is not the prompt

This decision was easier because Kiso treats its event log as the durable record of execution. The log records turns, permissions, tool executions, results, and compaction boundaries. The model's next prompt is a projection of that record. It is not the record itself.

That distinction matters after a crash. A process cannot safely infer what happened merely from the text it last showed the model. Kiso persists an execution start before a side effect and a receipt after the result is known. If the process dies between those records, recovery reports an uncertain outcome instead of automatically repeating the action. Context compaction does not erase the underlying events or turn an uncertain effect into a known success.

It also matters for caching. Given the same event-stream prefix, Kiso aims to project a byte-identical message prefix. Appending new events should leave the earlier prefix unchanged. A compaction decision becomes a durable event, so replay after a restart makes the same projection rather than letting a new process make an invisible, different editing choice. The repository has regression tests for those cases.

The useful vocabulary became:

- **Event log:** the durable account of what the runtime knows happened.
- **Context:** the current representation supplied to the model.
- **Summary:** a lossy representation of older context.
- **Prompt cache:** a cost property of the representation sent to a particular provider.

Keeping these separate does not make summaries lossless or provider caches predictable. It gives the runtime a place to record what it deliberately changed.

## When a summary is worth the loss

Pruning tool results alone cannot bound a conversation forever. Kiso's CLI now has two context thresholds derived from the selected model's window. The soft threshold is half the window, capped at 400,000 tokens. Passing it makes a summary eligible; Kiso waits for a settled round that ends a phase, such as finishing a set of edits or checks. The hard threshold is 80% of the window, capped at 700,000 tokens; there the next settled round triggers compaction regardless of phase. A provider context error gets one compaction and one retry.

The 400,000-token cap is a quality choice, not a measured universal cost optimum. In some workload and price sweeps, earlier summarization was cheaper. An earlier summary also forces more of the agent's recent work through a lossy representation. I chose fewer such transformations at the cost of carrying more context, and that tradeoff deserves further measurement on real sessions.

When summarizing, Kiso first appends the summary instruction to the run's existing cached prefix. That preserves the prefix for the summary request where the provider supports caching. There is a fallback to a serialized form if the in-band request cannot satisfy the contract. Afterward the most recent tenth of the model window, capped at 100,000 tokens, remains verbatim. The summary lands as one durable event; the older raw events remain on disk.

This is not a claim that a long prompt is always cheap. Cache hits expire, providers differ, and context still has a hard capacity limit. It is a reason to measure billed cache reads and misses before replacing a stable prefix with something shorter.

## What I would measure next

A threshold sweep alone cannot settle the design. I want to measure how much material an agent re-reads after a summary, how often a “phase boundary” actually protects useful recent work, and whether the in-band summary gets the cache behavior expected from the prompt shape. Those observations could justify moving the thresholds or changing the policy entirely.

The broader lesson from building this part of an agent runtime is that token count is not the bill, and the bill is not the whole objective. I still need the agent to recover from interruption with an explainable record of what it knew, what it did, and which parts of its context were compressed. Making context shorter is valuable only when the cost and information loss are worth it.

Kiso is an [MIT-licensed agent runtime and CLI coding agent](https://github.com/vincemakes/kiso). The [context design notes](https://github.com/vincemakes/kiso/blob/main/docs/context.md) and [ADR-0055](https://github.com/vincemakes/kiso/blob/main/docs/adrs/0055-mid-turn-compaction-boundary.md) contain the current policy, its amendments, and the measurements behind it. I would be interested in examples where your provider's cache behavior changes this calculation.
