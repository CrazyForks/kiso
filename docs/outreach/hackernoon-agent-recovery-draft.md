# What an AI Agent Runtime Can Know After a Crash

**Disclosure:** I created Kiso, the open-source agent runtime discussed here. This is an English adaptation of my [original Chinese essay on V2EX](https://www.v2ex.com/t/1243519); I used AI assistance to translate and edit the English, and I reviewed the technical claims.

When I started Kiso, I wanted a coding-agent framework that was simpler, more stable, and cheaper in tokens than Pi. The first two goals sounded like implementation work: keep the tool set small, avoid a sprawling prompt, and make the loop easy to follow.

Then I tried to answer a more basic question: once an agent can change files, run shell commands, or call a remote API, what evidence does its runtime have about what actually happened?

That question changed the project. Kiso still includes a CLI coding agent, but the part I spend the most time on is the runtime beneath it. The model can propose an action. The runtime has to decide when that action is allowed to affect the world, record what it knows, and recover honestly if the process disappears.

## A finished loop can leave an unfinished effect

The familiar loop is straightforward: send context to a model, execute its tool call, add the result, and ask the model what to do next. The control flow returns to the model. That does not mean the real-world operation completed cleanly.

Consider a tool that sends a payment request. The server may accept it, then the agent process may crash before saving the response. After restart, the local history says no success was recorded. It does not say the payment failed. Retrying blindly could send the payment twice; assuming success could skip work that never happened.

The same window exists in less dramatic tools. A file write may reach disk before the result is logged. A Git commit may be created just before a kill signal. An HTTP request may reach a server even though the client never receives its reply. The outside world is not a database transaction that the runtime can roll back.

So I stopped treating these statements as interchangeable:

- The model proposed a tool call.
- The runtime authorized the call.
- The tool began running.
- The outside world changed.
- The runtime recorded the result.

Each is a separate fact. A tool intention is not an effect, and a started operation is not a successful one.

## Commit the model's turn before executing it

Streaming creates an earlier failure window. A provider can send part of a response and then disconnect, or the response may end with semantics that mean it is incomplete. If a runtime executes a tool as soon as it sees the beginning of a streamed tool call, the world can change based on an answer that was never accepted as a complete turn.

Kiso first waits for the response to finish cleanly. It then durably commits the turn. Only committed tool calls proceed through permission checks and execution. Until that point, the streamed output is a draft.

This gives recovery an important distinction: a tool call that was visible in a partial model stream never became eligible to run. The runtime does not have to guess whether a half-written assistant message was meant to authorize an action.

## Persist before the side effect

For each committed tool execution, Kiso records a durable `started` event before invoking the side effect. When the tool returns, it records a success or failure receipt. The durable history therefore has a sequence like this:

```text
complete model response
        ↓
durable turn commit
        ↓
permission check
        ↓
durable execution started
        ↓
external side effect
        ↓
durable result receipt
```

If the process crashes before `started`, the tool did not begin. If `started` and a receipt both exist, the result is known. The ambiguous case is a durable `started` with no receipt. The side effect may or may not have reached the outside world.

Kiso marks that execution `uncertain` and pauses the trajectory. A person must choose whether to rerun or abandon the operation. The runtime does not silently replay it.

I call the rule **Ambiguity Never Auto-Repeats**. It is a deliberately narrow guarantee: Kiso cannot provide exactly-once effects for arbitrary tools and remote services. It can make uncertainty visible and prevent its own recovery loop from turning uncertainty into an automatic duplicate.

## The event log is the record; the session is a projection

Kiso stores session history in an append-only event log. The execution ledger, current session state, and recovery plan are derived views of those events. They are not separate authorities that must be kept in sync after every crash.

That makes recovery a deterministic question about durable evidence: what events are present, and what is the next safe step? It can discard an uncommitted model draft, wait for permission, run a committed execution that never started, pause on an uncertain effect, or resume model reasoning after recorded results.

I tested this with a real subprocess rather than a simulated crash flag. The test lets the coding agent finish a file edit, starts a slow shell command, then sends `SIGKILL` to the process group. After `kiso resume`, the file edit remains recorded as completed while the interrupted shell execution is marked uncertain. Once the operator resolves that execution, the same trajectory continues.

This is what I want “resume” to mean for an agent: continue from durable evidence, not reconstruct a plausible conversation and hope it matches reality.

## What this design does not solve

An event log cannot reveal what a remote server did if the client lost the response. Marking the result uncertain does not undo an external action. Human resolution can still be wrong. And a successful tool receipt does not prove the user's larger goal was satisfied: a successful file write does not prove the code is correct, and a zero exit code does not prove the task is done.

Those limits are why the runtime separates execution evidence from goal evaluation. It can record that a command exited successfully; a fresh observation, tests, or a human still need to decide whether the work achieved its purpose.

Kiso is an [MIT-licensed agent runtime and CLI coding agent](https://github.com/vincemakes/kiso). Its [recovery design notes](https://github.com/vincemakes/kiso/blob/main/docs/adrs/0025-execution-identity-and-crash-safe-recovery.md) describe the event and uncertainty model. The longer [V2EX essay](https://www.v2ex.com/t/1243519) includes the original project motivations, context design, tool safety, and benchmark discussion.

**Disclosure:** I am Kiso's creator. This article describes a design in my own open-source project; the English version was translated and edited with AI assistance and reviewed by me.
