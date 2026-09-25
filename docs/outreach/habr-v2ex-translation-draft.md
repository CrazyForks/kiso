# Building Kiso: What Can an Agent Runtime Know After a Crash?

> English translation of my [original Chinese article on V2EX](https://www.v2ex.com/t/1243519). Original author: Vince Wang. Prepared for review before any Habr submission.

I open-sourced a small agent framework called Kiso.

It began with a fairly simple question: could I build an agent framework that was simpler, more stable, and cheaper in tokens than Pi? As someone researching agents with a bit of an engineering ideal, I wanted to leave a trace of my own in open-source agent development. So I built another wheel, even knowing that much of it might overlap with existing work.

“Simple, stable, and token-efficient” were three wishes written on the first page of my notes. Engineering reality was less accommodating. When I took apart reference implementations such as Pi, I found that Pi had already pushed minimalism quite far: few default tools, a restrained system prompt, and little unnecessary control logic in its loop. Removing two more tools or a few hundred prompt tokens offered limited room for meaningful change.

As the project progressed, the problem I wanted to solve changed.

I began to think that the reason an agent is hard to trust is often not that it cannot call a particular tool, or that it lacks memory, planning, or a multi-agent component. Models will improve, and those components will evolve. But once an agent changes the outside world through a filesystem, shell, Git, browser, or network API, a more basic question appears:

**When a probabilistic model starts changing reality, how does the system know what actually happened?**

That question determined much of Kiso's direction.

At first I tried to give “agent” a first-principles definition: a closed-loop system that continually observes a partially known world, acts on it, reads feedback, and moves its real state toward a goal. The definition was useful for thinking, but I did not need to turn this into an argument about the one true definition of an agent. Kiso only needed to address a narrower kind of system: one that observes the external world, invokes tools with side effects, and may run for a long time or crash halfway through.

Once I narrowed the scope, several distinctions became hard to avoid:

```text
Observed ≠ Current
Intent ≠ Effect
Started ≠ Succeeded
Process Completion ≠ Goal Satisfaction
Memory ≠ Durable Fact
```

Something the model saw may no longer be current. Generating a tool call does not mean the outside world has changed. Starting an operation does not mean it succeeded. A loop finishing normally does not prove that the user's actual goal was met. And something a process remembers cannot be treated as a fact after a crash unless it was made durable.

As I worked on Kiso, I increasingly felt that “agent framework” was an adequate public description but not quite the right engineering one. It was becoming an agent runtime. I eventually reduced the division of responsibility to one sentence:

**The model expands the space of problems a system can handle; the runtime constrains what is allowed to count as fact.**

Most of the engineering decisions that followed began there.

## 01. A closed control loop is not a closed loop in reality

The common agent loop is simple: the model receives context and produces a tool call; the runtime executes it and returns a result; the model reasons again until it stops. The arrow returns to the model, so the control flow looks closed.

But when I wrote a coding agent and let it work on longer tasks, I found that a closed control loop did not imply a closed loop in reality.

The model is not interacting with a static state machine. A person may edit a file at the same time. A Git branch may change. A shell command may be halfway through execution. An HTTP request may already have left the machine without a response returning. The process itself can be killed between any two instructions.

These situations cross several different semantic boundaries.

The first is a boundary of knowledge. Every input the model receives is a projection of some earlier slice of the world. Even a million-token context window can retain only what was observed, not the continuously changing world itself. A file read thirty seconds ago may already have been changed by an IDE, Git, a background process, or another agent.

The second is a causal boundary. A `tool_use` appearing in the model stream is an intention to act. Between that token and a byte being written to disk stand the runtime, authorization, tool execution, and operating system. Equating “the model said to do it” with “it happened” may seem harmless in a normal run. During crash recovery, it destroys the causal account.

The third is a persistence boundary. A process may know that a tool succeeded without being able to prove it after a restart. If that knowledge exists only in a promise, an object field, or the call stack, a power loss makes it unavailable.

Finally, there is an evaluation boundary. A tool returning success proves only that its local operation completed. A successful `write_file` does not prove the code is correct; `npm test` returning zero does not always prove the user's goal is satisfied. Completion may require a fresh observation, a test, an acceptance check, or a human judgment. It should not follow automatically from the model declaring the task finished.

These boundaries shaped Kiso's structure. Once I accepted them, I could no longer think of an agent runtime as merely a `while` loop between an LLM and a tool. It had to preserve a causal chain that would still be intelligible after a crash:

```text
Model Intent
    ↓
Turn Commit
    ↓
Authorization
    ↓
Durable STARTED
    ↓
Real-world Effect
    ↓
Durable Receipt
    ↓
Observation / Verification
```

The model's output can be probabilistic. The boundary at which the world is permitted to change, and the evidence the system retains afterward, should be as determinate as possible.

## 02. Fail-stop interruptions and the execution ledger

The first practical test of this idea was a process crash.

Suppose the agent has finished modifying one file and has started a slow shell command. The user closes the terminal, the machine loses power, the OOM killer acts, or we send `SIGKILL` ourselves. Where should the agent continue after restart?

Many lightweight agents save an interaction history: user message, assistant response, tool call, tool result. That works well during an ordinary run. But there is a difficult window:

```text
Tool Call
    ↓
The real-world side effect may be happening
    ↓
Tool Result
```

If the process dies in the middle, the disk may contain only “I am going to perform this operation,” with no final result. The outside world is not one database transaction that the runtime can roll back. The file may have been written; a Git commit may exist; a remote server may have accepted the HTTP request. Automatically retrying can create a second effect. Assuming success can build the remainder of the run on something that never happened.

Kiso therefore does not treat the current in-memory session state as the final authority. Its sessions are built on an append-only event log. State that matters to later decisions must be recorded as an event.

An operation with a side effect follows roughly this sequence:

```text
The model completes a response
    ↓
Durable Turn Commit
    ↓
Permission check
    ↓
Durable tool_execution_started
    ↓
Real-world side effect
    ↓
Durable succeeded / failed receipt
    ↓
Result projected back to the model
```

Two boundaries in this sequence matter particularly to me.

The first is **Turn Commit**. During streaming, the model may produce the beginning of a tool call and later emit invalid content. The provider may disconnect, or the complete response may turn out to be invalid. If the runtime starts modifying files as soon as it sees the partial call, reality has changed even though the response was never accepted. Kiso separates “the model proposed a tool call” from “the call is eligible to execute.” Only when the full response has cleanly completed with compatible termination semantics does the turn receive a durable commit. Before that, it is a draft.

The second is **Persist Before Effect**. The runtime must persist `tool_execution_started` before the side effect. After the effect, it persists a receipt for success or failure.

After a crash, the runtime can then say what it has evidence for. No commit means the model's draft was never eligible to act. A commit without `STARTED` means the tool had not begun. `STARTED` together with a receipt gives a known outcome. One interval cannot be resolved from local evidence alone:

```text
Durable STARTED
    ↓
The real-world effect may have happened
    X  ← crash
    ↓
Durable Receipt
```

This is the difficult **unknown effect**. Kiso does not guess. It marks the execution `uncertain` and pauses recovery so a human can choose whether to rerun or abandon that execution. Only then does the original trajectory proceed.

I gave this rule a short name: **Ambiguity Never Auto-Repeats.** An uncertain side effect is never retried automatically.

I also did not want a second, special recovery state machine. The event log is the record on disk; the execution ledger, current session state, and recovery plan are projections of it. Recovery is a pure function of durable events. It can discard an uncommitted draft, wait for permission, execute a committed call that never started, resolve an uncertain operation, or return to the model.

In other words: **the event log is the truth; everything else is a projection.**

I wrote a real `kill -9` test for this. It starts the agent in a PTY subprocess, lets it complete a file edit, begins a slow shell command, and then sends `SIGKILL` to the process group. On `kiso resume`, the earlier edit must remain known as completed, while the interrupted execution is `uncertain`. Once a human explicitly chooses to rerun, the agent continues the original trajectory instead of reconstructing a plausible story from a saved chat transcript.

That was the point at which `resume` began to have a concrete engineering meaning for me.

## 03. Context is not fact: caching and compaction with a million-token window

Once the event log was established, I could separate three things I had previously mixed together: conversation history, context, and agent state.

It used to be easy for me to treat them as one object. When the context approached the limit, I would delete some tool output, then summarize, then continue appending messages. But if the event log is the durable history of what happened, the context the model sees on any particular request is only a temporary representation of it.

**Context is not the fact itself. It is a projection the runtime constructs from facts for the model's next request.**

Compressing context therefore does not alter history. The event log still contains what happened. The runtime can project the same history in different ways for a particular model, context window, task phase, and cost constraint. The question changes from “should I delete history?” to “how do I project durable history into the context the model needs next, at a reasonable cost, while preserving its ability to reason continuously?”

I initially followed a natural two-stage design. At about half the context window, run a small compaction that removes some large old tool results. Near the top of the window, run a full summary. By token count, it looks sensible: prune lightly first, summarize later, and save money at both stages.

Accounting for prompt caching reversed that conclusion.

With a provider such as DeepSeek, where cached and uncached input can have very different prices, an append-only conversation can keep matching a long previously seen prefix. The context may look large, but much of that prefix need not be billed as a fresh prefill on each request.

Remove an old tool result from the middle, however, and every token after that point shifts. A prompt that is 30,000 tokens shorter might also turn a 200,000-token cached suffix into a cache miss. The pruning only pays if enough future requests save enough tokens to recover that immediate cost. If the task ends ten turns later, it may make the bill larger.

Kiso therefore removed fixed-percentage automatic microcompaction from its CLI. The pruning primitive remains, but it must pass a break-even check: are enough future calls likely to recover the cost of invalidating the prefix? A large context, by itself, is no longer a reason to cut out the middle.

Summary compaction is a separate decision. With a one-million-token window, Kiso caps the soft threshold at 400,000 tokens and the hard threshold at 700,000, preserving up to 100,000 recent tokens verbatim. I wrote an explicit qualification into the design record: **400,000 was not proved to be the cost optimum.** In some threshold sweeps, summarizing at 150,000, 200,000, or 300,000 tokens was cheaper for particular workloads. The 400,000 choice accepts some additional context cost to summarize less often and lose less information.

Crossing the soft threshold does not summarize immediately. It makes the run eligible and waits for a phase boundary: a test just finished, a stretch of edits ended, or read-only investigation became implementation. Human engineers also tend to take stock after finishing an investigation or a set of changes, not the instant their mental buffer reaches an arbitrary percentage. If no such boundary arrives, the hard threshold forces the issue.

Compaction keeps the most recent raw tail, capped at 100,000 tokens. Recent errors, tool results, and edits remain verbatim while older history is compressed. Kiso also requests the summary *in band*: it reuses the current session's system prompt and message prefix and appends a summary instruction at the end. For the provider, that existing prefix can still match its cache, rather than being replaced by a newly serialized wall of text.

My working vocabulary for context engineering eventually became:

```text
Event Log    = Truth
Context      = Projection
Summary      = Compressed Projection
Prompt Cache = An economic property of the projection
```

The event log answers what happened. Context answers what the model should see next. A summary is lossy. The provider's cache is not agent state; it is a cost property of how the current projection is sent. I find this distinction more important than arguing in isolation about whether to compact at 50% or 80% of a window.

## 04. Tool design: shell, budgeted reads, and stale observations

Even a careful runtime must touch reality through tools. If tool design is only a collection of existing functions wrapped in JSON schemas, many of the same problems reappear at that boundary.

Kiso's default coding tools are deliberately few: `read_file`, `list_dir`, `search_text`, `write_file`, `edit_file`, and `shell`. Subagents, skills, asking the user, tasks, and MCP grow from extensions rather than joining the base tool list. Some of the smaller decisions here took several reversals.

The first is why the command tool is named `shell` instead of `bash`. It is not a naming preference. Kiso does not want the model to inherit the user's entire interactive shell environment. It invokes commands through the system shell, binds the working directory to the project workspace, and scrubs the child process environment. An API key or token held by Kiso should not appear in the model context merely because the model runs `env` or `printenv`.

Permission decisions are harder. If every command requires approval, `git status`, `ls`, and `grep` make the agent unusable. A blacklist of dangerous commands is no better: shell syntax can hide side effects in command substitutions, redirections, subshells, environment variables, or Git configuration.

Kiso uses the opposite criterion: **only operations that can be proved read-only are allowed automatically.** Its read-only-shell logic parses the command. It abstains on backticks, `$()`, subshells, background execution, and other constructs it cannot establish as safe. Each part of a pipeline or semicolon-separated command must satisfy the read-only conditions. Access to `.env` files or credential paths still goes through the permission chain. Even a `git -c` command may use configuration to launch an external program, so it is not treated as an ordinary harmless Git read.

When the parser does not know, it does not know. **Unknown is not safe.**

The second decision is why `read_file` defaults to at most 200 lines or 16,000 characters for normal code. Reading an entire file can fill context with thousands of lines. Cutting every read into tiny slices can make the model issue repeated calls just to understand one function. I settled on a simple budget: line count keeps code structure visible, while the character cap stops a single giant JSON line, minified bundle, or source map from consuming the window. The truncation normally occurs at a full-line boundary, and the result tells the model where to continue.

I did not make the underlying file tool count provider-specific tokens. Claude, OpenAI, DeepSeek, and Qwen use different tokenizers; a basic file tool should not be tied to one of them.

At first I suspected that the 200-line limit was too conservative. In an early benchmark Kiso cost substantially more than Pi on long tasks. My immediate story was that Kiso must be forcing the model to read files repeatedly in small pieces. It sounded convincing. Then I inspected the actual trace: the longest file in those tasks had only 132 lines. The 200-line limit had never fired. The additional cost came from failed retries of the edit tool. This episode stayed with me: however elegant an engineering explanation sounds, without a supporting trace it is still a story.

There is a more fundamental tool problem: **observed is not current.** The agent might read a file, think for a minute, and only then edit it. Meanwhile a person, a shell command, or another process may have changed the same path. Applying the model's diff against that new reality would allow an old observation to overwrite a newer state.

Kiso's `read_file` therefore returns both the contents and a revision for the file state observed. A later `write_file` or `edit_file` of an existing file must present that revision. Immediately before writing, the tool reads the current file and checks it:

```text
read_file
    ↓
content + revision
    ↓
model searches, reasons, calls other tools
    ↓
edit_file(expectedRevision)
    ↓
re-read the current file before writing
    ↓
same revision    → allow the edit
changed revision → reject and require a new observation
```

The revision does not prove that the model understood the file. It proves a narrower fact: whether the file state on which this edit was based still holds at the moment of writing. The execution ledger asks “did I actually do this?” The revision guard asks “is what I saw still true?” One prevents the runtime from inventing certainty about the past; the other prevents the model from passing an old observation off as the present. To me they are two parts of the same problem.

## 05. Permission boundaries: extend capability without merging the actor and the judge

As models grow more capable, it is natural to interrupt them less often. Nobody wants an approval dialog for every line an agent edits. At the other extreme, granting the model the entire workspace and shell makes it hard for the user to know what was authorized.

Kiso's CLI currently has five main modes: `default`, `accept-edits`, `plan`, `dontAsk`, and `bypass`. In `default`, operations that can be proved read-only run directly, while side effects need approval. `accept-edits` permits routine file changes but still evaluates more open-ended shell effects. `plan` is read-only and rejects writes and other side effects. `dontAsk` is intended for unattended execution: anything that would require a human approval is denied, so the model must find another path within its existing permissions instead of waiting indefinitely for a response. `bypass` allows most ordinary operations.

Even `bypass` does not simply switch off every protection. Kiso's own credentials and clearly catastrophic path operations still have lower-level guards. Giving more authority is a runtime policy; catastrophic boundaries should not be a casual UI toggle.

The particular list of modes interests me less than the design tendency behind them: **capability can extend outward, but the actor and the judge should, where possible, remain separate.**

Consider the Ask extension. When an agent encounters an ambiguous requirement, it can make a guess or stop in natural language and hope the surrounding product handles it. Kiso instead makes asking a human an explicit protocol action. When an interactive bridge exists, the model can call `ask_user`; in a headless or piped session where nobody can answer, that action is not offered to the model at all. Not knowing is a legitimate state.

Or consider subagents. The Delegate extension can hand a relatively independent task to a child agent, and the child session is also durable and resumable. But it is not an unrestricted copy of its parent. The parent can restrict writable paths; high-risk capabilities may be omitted from a restricted child. And when the child says it has finished, that claim need not be the acceptance criterion. The parent session can hold an independent check or perform a higher-level verification after the child returns.

This is the same idea behind the execution ledger. The model may propose an action, but cannot simply write its proposed outcome into history. It may perform a task, but a claim of completion does not make the target state true.

I do not think the model is deliberately lying. A probabilistic system is good at producing a coherent account from the context it has. If the same system proposes a hypothesis, takes action, records the facts, and judges the result, it may produce a story that is consistent internally but false about the world. The runtime's job is to keep some factual boundaries independent of the model as its capabilities improve.

## 06. The 2,200-line kernel limit and a benchmark

If these execution semantics matter, how do I stop them from being buried in a central loop as providers, tools, extensions, TUI features, MCP, and subagents accumulate?

The central loop is the natural place for framework code to grow. It already has the most state. Adding one `if` there is the fastest fix for a new feature; routing unrelated modules through it is the fastest way for them to communicate. Each change can be locally reasonable, and years later the result is a blob nobody wants to touch.

Kiso therefore has a deliberately blunt guardrail for `packages/core/src`: effective source code cannot exceed **2,200 lines**. At the time of the original article it stood at **2,192**.

The number is not a theoretical constant. Another language or line-count method could produce a different result. It is a tripwire. With eight lines of headroom, a proposed kernel change must answer: why does this decision belong in the kernel instead of runtime, tool, extension, or product code? If it is wrong, will it change the fundamental execution semantics? If it must go in, can something else come out first?

The point is to protect ownership of decisions, not to make a small number look impressive. Roughly, Kiso has a product shell for CLI and TUI, composition for assembling providers, tools, extensions, and the store, an agent layer that defines and creates sessions, a session with the durable conversation and recovery entry point, a run with one execution lifecycle, and a kernel loop for the central model/tool drive. The store makes the persistence decisions around a single writer, compare-and-swap, and torn tails.

Nor do 2,200 kernel lines mean the entire system's reliability rests on 2,200 lines. The actual trusted computing base is larger: recovery depends on the store, process locks, the OS, and filesystem; the revision guard lives in the node tools; a provider might violate its protocol; even the disk has limits to what it can guarantee. The rule keeps only decisions that affect event order, eligibility to act, and causal promises in the kernel. Other capabilities should grow outside it.

Architecture records alone would not tell me whether those decisions worked. Before launch I built a paired benchmark against Pi. Both ran with the same model and parameters. The order alternated within each task pair to reduce systematic effects of time and provider conditions, and each task began from a clean Git repository. Tasks included fixed cross-file changes, a long session, and a set of seeded hidden tasks whose specific contents I did not know before running them.

The run left **48 pairs, 96 task legs**. The result was useful precisely because Kiso did not win everything. Both systems completed all 12 fixed cross-file tasks and the long sessions; on the hidden seeded tasks, both completed **22 of 24**. Kiso's cost on the hidden tasks was about **32% lower**, while the long-session workload cost **19% more** with Kiso. These figures are observations from that benchmark, not a general claim that either system is always cheaper.

That 19% initially made me suspect the 200-line `read_file` limit. But the longest relevant file was only 132 lines. The difference was in editing: Kiso made 360 edit attempts with 26 failures; the comparison made 287 attempts with 3 failures. The failures clustered around appending code at the end of a file. Kiso's `edit_file` required a strict search anchor and replacement text. In a long context, the model sometimes mixed the original content with the intended appended content; the anchor did not match, so the tool refused the edit. The model then had to reason again and retry with new arguments.

Refusing an unmatched edit is the correct defensive action. It does not mean the tool interface is good. If a model repeatedly fails on one kind of intention, perhaps the interface needs a more direct atomic operation such as append. The extra 19% exposed a specific tool-design problem, not a reason to dismiss the model as incompetent.

I did not change the tool immediately after the benchmark and then present a more flattering set of numbers. Once the tool contract changes, that round of paid comparison no longer describes the same system. Architectural claims can sound excellent on a whiteboard; actual trajectories should show where the design helped and where it failed.

## Closing thoughts

Why start with a coding agent? I once wrote my engineering view of AGI as a simple formula:

```text
AGI = Weights + Harness + Experience Stream + Update Mechanism
```

Coding agents operate in a world that gives relatively quick feedback. After an edit or command, tests turn red or green, compilers report errors, diffs show what changed, and a program either runs or does not. The trajectories left by real execution might later become evaluation data, accumulated experience, or even inputs to some update mechanism. Kiso is a long way from that.

For now it has to make progress on the three original wishes: simpler, more stable, cheaper in tokens. The benchmark shows that I have not achieved all three. I have a recovery design I believe in, but some tasks cost less and some long tasks cost more. The tool interface has identifiable weaknesses. The context strategy is not a final answer.

That is why I am releasing the project. Designs that only circulate inside my own repository can become increasingly self-consistent without being challenged. When others run Kiso, kill the process, and compare it with another agent, the necessary decisions and my personal biases should become easier to distinguish.

The code, architecture decision records, and benchmark implementation are on [GitHub](https://github.com/vincemakes/kiso). To try the coding agent on macOS or Linux with Node 22 or later:

```bash
npm install -g @vincemakes/kiso-code
kiso
```

The first launch needs no API key; it starts with a built-in scripted trajectory. To inspect recovery, start a task in a real project, interrupt a slow side-effecting command with `kill -9`, and run `kiso resume`. See whether it can explain what actually happened before the interruption.

If a design decision looks wrong, open an issue. I overturned several of my own decisions during the roughly two months spent building Kiso; I am ready to reconsider another one.

---

Original Chinese article: [V2EX](https://www.v2ex.com/t/1243519). Project and test code: [vincemakes/kiso](https://github.com/vincemakes/kiso).
