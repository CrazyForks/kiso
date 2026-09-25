# The crash window that decides whether an AI agent retries a tool

**Disclosure:** I created Kiso, the open-source agent runtime in this article. I used AI assistance to edit this English draft, and I reviewed the implementation details and claims.

An agent can send a tool call, the tool can change the outside world, and the process can die before the runtime records the result. After restart, the conversation may show no result. That does not tell us whether the action happened.

This is the awkward gap I ended up designing around in Kiso. A tool execution is not just “success” or “failure.” The runtime needs to know which facts were durably recorded before it decides what to do next.

## A tool call crosses two systems

Suppose an agent runs a shell command that creates a release, or calls an API that opens a ticket. The runtime controls its own event log. It does not control the remote service or the filesystem as part of the same transaction.

There is no atomic operation that commits both “the external effect happened” and “the runtime received its reply.” The process can be killed between those events. Retrying may duplicate the effect; assuming success may leave the task incomplete.

In Kiso, I keep the durable execution sequence explicit:

```text
complete model turn
  → commit the turn
  → check permissions
  → append tool_execution_started
  → call the tool
  → append a success or failure receipt
```

Each execution gets a runtime-generated `executionId`. The provider's tool-call ID is useful for correlation, but it is not the identity of the execution: providers may reuse it, and a user may intentionally run the same command twice. Kiso does not deduplicate executions by comparing tool name and input.

## A receipt and an interrupted call mean different things

Recovery looks at durable events, not at what the last chat message seems to imply.

If there is a `tool_execution_started` event and no terminal receipt, Kiso cannot know whether the effect reached the outside world. That execution is marked uncertain. Resume pauses until a person chooses to rerun it or abandon it.

If a success or failure receipt exists, the execution outcome is known to the runtime. A failed receipt is not silently upgraded to “unknown.” For a tool that is not known to be idempotent, Kiso includes a warning that partial side effects may have occurred. The model receives that failure and warning before proposing another call; the retry is a new execution and passes through permission checks again.

That distinction matters. Treating every failure as uncertain can block harmless failures, such as a read-only tool returning “file not found.” Treating a started call with no receipt as an ordinary failure can repeat a payment, deployment, or other side effect. The uncertainty belongs to the crash window: started, but no receipt.

This is not an exactly-once guarantee for arbitrary tools. The runtime cannot roll back a remote action or infer what a server did after a lost response. It can preserve the evidence it does have and refuse to turn missing evidence into an automatic retry.

## The log has to survive the same crash

An execution ledger is only useful if the storage beneath it has clear failure behavior. Kiso appends events to a JSONL log under a single-writer lock and syncs them before publishing them to the in-memory view. When loading, it repairs an incomplete final line before the next append, but treats corruption in the middle of the log or a sequence gap as an error.

The session state and recovery plan are derived from those events. That keeps one durable record as the source of truth instead of asking multiple files to agree after a crash.

There are still limits. A person can choose the wrong resolution for an uncertain call. A tool can partially change the world and then return a failure. A successful receipt only says the tool reported success; it does not prove that the user's larger goal was achieved. Kiso records execution evidence, while tests or a fresh observation still need to establish whether the work is correct.

The implementation is in [Kiso](https://github.com/vincemakes/kiso). [ADR-0038](https://github.com/vincemakes/kiso/blob/main/docs/adrs/0038-uncertainty-belongs-to-the-crash-window.md) defines the current uncertainty rule; [ADR-0025](https://github.com/vincemakes/kiso/blob/main/docs/adrs/0025-execution-identity-and-crash-safe-recovery.md) covers execution identity, storage recovery, and resume, with its supersession note. The [Kiso site](https://kiso.work) has the project overview.

I would especially like feedback from people building agent runtimes: where should the boundary sit between a runtime retrying automatically and asking a person to resolve an uncertain effect?
