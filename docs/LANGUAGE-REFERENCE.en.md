<!-- translation-source: docs/LANGUAGE-REFERENCE.md -->
[Korean original](LANGUAGE-REFERENCE.md)

# GhostFlow Language Reference

GhostFlow is a reactive control language that describes **changes in state and output intentions for devices** from sensor and user inputs. This reference is the shared ground truth for the language's philosophy, syntax, semantics, type rules, usage constraints, and the rationale for each feature.

For coding examples by behavior, see the [GhostFlow Coding FAQ](language_faq.md).

## Complete contents

| Chapter | Contents |
|---|---|
| [1. Source and syntax](reference/01-source-and-syntax.en.md) | Literate source, code blocks, intent anchor/link, vocabulary, names, scope, declaration structure |
| [2. Types, expressions, and state](reference/02-types-expressions-state.en.md) | Literals, integers, units, operators and precedence, functions and branching, tick, state, output |
| [3. Time and schedules](reference/03-time-and-schedules.en.md) | Clock time and elapsed time, timers, DailySlots, Solar, Cron, Periodic, calendars, natural events, fallback |
| [4. Sensors, constraints, and control](reference/04-sensors-constraints-control.en.md) | Quality, filters, hysteresis, device capabilities and adaptation, shared resources, modes, time budgets, continuous control |
| [5. Settings and observation](reference/05-settings-and-observation.en.md) | Typed settings and automatic input forms, live changes, temporary values, snapshot, event, command, alarm, explanation |
| [6. Composition and replay](reference/06-composition-and-replay.en.md) | Behavior composition, import, instance, port, binding, semantic DAG, syntax extensions, replay, ghost, replacement |
| [7. Semantic preservation rules and index](reference/07-semantic-rules-and-index.en.md) | Distinguishing errors, transformation equivalence, indexes of all notations, symbols, terms, and original documents |
| [8. FAQ requirements and layer responsibilities](reference/08-language-runtime-and-device-boundaries.en.md) | Language, compiler, runtime, environment, Driver, binding, UI responsibilities across the FAQ, lifecycles and required contracts |

Each chapter is part of this document. Read the relevant chapter directly from the contents for a particular feature. Use the [syntax index](reference/07-semantic-rules-and-index.md#75-선언과-표기-찾아보기) to find all notations. See the [Chapter 8 responsibility table](reference/08-language-runtime-and-device-boundaries.md#83-faq-전체-책임표) for what each layer needs to support the FAQ requirements.

## Reading conventions

- **Syntax** explains the notation used in source and its meaning.
- **Design notation** explains concepts from design documents and discussions. Do not arbitrarily mix it with settled notation.
- **Rules** define the meaning of types, scope, evaluation, errors, time, and state.
- **Why** explains why a feature is needed and which language principles it preserves.
- An example **fragment** omits surrounding declarations for explanation. Distinguish it from a complete document example.
- Technical syntax and semantic decisions follow the rules in each chapter. Field operating choices remain explicit arguments and are not filled with hidden policy.

The syntax policy consolidation of 2026-09-22 is a normative decision of this Reference. Where earlier design sketches and notations conflict, follow the precise type, syntax, and evaluation rules in this document. [§8.6](reference/08-language-runtime-and-device-boundaries.md#86-언어-결정과-작성자가-정하는-정책) distinguishes user-selected operating values and external responsibilities.

When documents from different periods conflict, follow the subsequent decision that explicitly changes that scope. For example, operating settings follow the **atomic live event within the same program and the same execution** semantics of [#105](https://github.com/callin2/ghostflow-language/issues/105) and [#110](https://github.com/callin2/ghostflow-language/issues/110). This decision does not also change the meaning of installation mode transitions or arbitrary state writes.

## Design philosophy

Imagine that a pump stops at four in the morning. The person who wrote the program cannot be reached, and someone at the site has to find the cause.

That person needs a program that helps them understand why the equipment stopped, what to check, and what they may change. If someone has to remember circumstances that cannot be found in the code, the only option may be to call that person again.

As I designed GhostFlow, I often returned to one principle:

**It should be possible to read and change it on site, even at four in the morning.**

At first, I wanted to make the control usually done with a PLC easier to build on an inexpensive MCU. But turning on a relay when someone presses a switch was not enough. The reasons for behavior should remain understandable over time; existing work should remain useful when equipment changes; and someone else should be able to take over when the original author is gone.

The principles below grew out of those choices.

### 1. Keep the reason for the code with the code

“Open the valve, then start the pump three seconds later.”

The code might say that. But why wait three seconds? Is that how long the valve takes to open, extra time allowed for the pipes, or a number added for a trial? Without knowing, it is hard to tell whether reducing three seconds to one is safe.

That is why GhostFlow puts explanations and code in one `.ghost.md` document. The document records not only what the program does, but why it was chosen and which equipment and conditions it assumes, linked to the relevant code. Later, someone should be able to trace which explanation supports the code and what changed in each revision.

This distinction matters even more when AI writes code. What the user actually asked for and what AI guessed to fill a gap are different things. Unconfirmed assumptions must remain labeled as assumptions. A plausible explanation does not become the user's intent just because it sounds convincing.

### 2. A decision to turn on the pump is not proof that it turned on

Even if a program asks for the pump to turn on, the pump may not run if power is lost or the equipment has a fault. A screen that says ON must also distinguish a request to turn on from confirmation that it actually did.

GhostFlow takes inputs and computes what action to request. A binding records which port and device should receive that request, while a Driver handles the actual hardware. The rule “stop the pump when water is low” should not also contain a pin number for a particular board.

This separation lets the same rules be tested with virtual switches and lamps before connecting them to real equipment. It also makes it possible to compare behavior without sending real outputs. But a request produced in a virtual run and equipment moving correctly on site remain separate facts that must be checked separately.

### 3. Make memory and the next change in state visible

For a motor to keep running after someone releases the start button, the program has to remember that the button was pressed. A program that opens valves in sequence also needs to know which valve it is on.

That memory belongs in `state`. Functions calculate from the values they receive; state carries memory from one decision to the next. I do not want a function call to quietly change some value elsewhere.

What matters to me is a structure where **the next state can be read directly from the current state and inputs**. If a reader has to replay the execution order in their head several times to understand it, changing the program on site will be even harder. When a calculation result feeds another decision, the state connecting those calculations should also be clear.

### 4. Be able to check yesterday's decision today

“Why did it ask the pump to turn on at three yesterday afternoon?”

If the inputs, previous state, effective settings, and time conditions from then were recorded, the same conditions should produce the same decision. That makes it possible to investigate the cause instead of relying on memory or guesswork. After changing the program, the same conditions can also show what changed.

For this, one control calculation, or tick, uses the same input snapshot and previous state. The next states are committed together after calculation. Results should not depend on which source line happened to run first or on a function secretly reading the clock. It should also be clear which calculation first uses a settings change.

AI can help write programs, but I do not want each operating decision to depend on a fresh AI answer. At the site, confirmed rules should run under defined conditions, and the decision should be traceable later. The basic control assigned to the device should continue on site without waiting for the internet or an AI response.

### 5. Do not make readers guess what a number means

If a setting just says `10`, someone has to search nearby code to learn whether it means ten repetitions, ten seconds, or ten percent. A meaning that seemed obvious to the author may be forgotten a few months later.

GhostFlow distinguishes counts, time, percentages, and physical quantities. It also distinguishes counts that need exact integers from numbers such as measurements that may be approximate. The language should check what a value means instead of relying only on its variable name.

When converting units or a decimal to an integer, the conversion should show what was changed, where rounding happened, and what was discarded. I want the language to catch some mistakes before they depend on a person noticing them during careful review.

### 6. Keep making decisions during ten minutes of watering

“Water at 6 a.m.,” “water for ten minutes,” and “do not exceed 30 minutes of watering in total today” are different requirements. Treating them all as one kind of timer because they involve time makes the meaning ambiguous when operation stops and starts again.

GhostFlow distinguishes the time a schedule starts, continuous elapsed time, accumulated usage, and recurring periods. It should also retain which schedule occurrence happened so that a repeated delivery can be distinguished from a new occurrence. Clock time and the basis for measuring elapsed time are separate as well.

Above all, the program must keep making other decisions while it waits for ten minutes. It still needs to notice a stop button or a low-water condition. It can express a condition such as “one hour after sunrise,” but what to do when sunrise cannot be determined must be decided separately.

### 7. Preserve the fact that a value is unknown

A temperature of zero degrees is different from being unable to read the temperature sensor. Having a last reading is also different from being able to trust that reading now.

Distinguish a value that has not arrived, one that is too old, and one that failed to read from a normal value. Failure to determine sunrise must not be treated as “the scheduled time has not arrived.” If an unknown situation is simply changed to zero or false, later decisions lose the information needed to find what went wrong.

Any alternative rule must be stated for the equipment's conditions. Even when a substitute value is used to continue calculation, keep the original missing information, why that choice was made, and when normal operation returned.

### 8. Separate the action a program wants from the action the installation allows

A watering program may want to start the pump when the tank is empty. Two programs may want the same pump, or equipment may forbid forward and reverse outputs at the same time.

Copying these conditions into many programs makes omissions and inconsistent edits likely. Keep each program's request separate from the installation-wide conditions that permit it. Make mutually exclusive outputs, shared-resource rules, mode permissions, and operating-time limits visible. When a request is blocked, it should be possible to see which condition blocked it.

Showing a user only “pump OFF” is not enough. They should be able to trace “watering was scheduled, but the low-water input prevented the pump from turning on.” This lets non-specialists ask in their own words and understand why an action happened. Explanations should follow the evidence from execution, not be plausible stories added afterward.

Program constraints do not replace physical safety devices. Responsibilities such as emergency stops and electrical protection still belong in hardware.

### 9. Do not rewrite the program just to change the watering time

In a program that waters for ten minutes every hour, someone may want to reduce today's duration to seven minutes. Having to edit the control code for that would make ordinary adjustment difficult.

Declare values that operators can adjust as settings. Give each setting a name, type, default, allowed range, and access permission, and make clear when a changed value takes effect. Changing a setting is different from changing the control rule or forcibly overwriting internal state.

Screens should be able to use this information too. A time setting can create a time input and guide the user to stay within its range. I like screens that feel like the switches and dials on an existing control cabinet, but they do not have to look that way. A phone can show the same setting differently. **The appearance of the screen may change, but the meaning of the operation should stay the same.**

### 10. If two good examples are available, they should work together

There may be one example for watering and another for ventilation. Each works on its own. But if using them on one board requires taking both programs apart and rewriting them, someone who is not comfortable coding may hit a dead end.

This has especially bothered me. If watering needs two inputs and three outputs, and ventilation needs four outputs, I want people to be able to bring in each program and connect its inputs and outputs to the equipment they need.

That does not mean matching only the number of inputs and outputs is enough. We must check whether programs share resources, whether their constraints conflict, and whether their states stay separate. The origin and revision of imported code and the devices currently connected to it should also remain traceable.

We must also remember that these programs run on small MCUs. A composition that looks simple must not lead to a calculation that never ends or memory that grows without limit. Its memory use and computation cost should remain assessable. The goal is to combine the convenience of reusing someone else's work with the conditions needed to operate it responsibly on one's own equipment.

## Perspectives that influenced the design

GhostFlow was influenced by tools I liked using. Rather than copying their syntax, I tried to bring over what made them convenient and understandable.

From **Literate CoffeeScript**, I liked reading explanations and code in one document. You can explain how equipment should behave and place code where it is needed. Rather than requiring a separate manual to be written well, I wanted explanation and code to live together from the start.

**ObservableHQ** influenced not only the way connected calculations and screens respond when values change, but also the idea of bringing someone else's notebook into your own work. A good result can become material for the next piece of work, instead of something to look at and leave behind. What mattered to me in **marimo and D3.js** was also keeping code and results together so their values and changes can be seen.

From **functional programming**, I took the idea of composing small calculations without hiding memory or side effects. From **Cycle.js**, I took the separation between receiving inputs, producing output requests, and letting a Driver create real effects. These ideas connect to keeping state, calculation, and hardware distinct.

**Elm and Rust** influenced my preference for checking problems with types and branch analysis before execution. I saw a similar value in **Railway-oriented programming**: both normal results and failure paths should be readable in the code.

From **YAML**, I took declarations that reveal the structure of names and settings. From **Cypher**, I took selecting by an object's characteristics and capabilities rather than its location. **Meta Lua** interested me as a way to treat code as data and extend it. But even when expressions are extended, their meaning and reach should remain checkable.

All these preferences point in the same direction. **I want what we understood while building something to remain available when someone changes it or takes it over.** Whether a person writes the program or AI helps, the person left on site should be able to read it and make a decision.

This section describes the design direction of GhostFlow. Check implementation status and what has been verified on real devices separately.

## Rules for maintaining this reference

When language semantics change, update the relevant chapter's **syntax, rules, examples, and Why** together. When a new requirement is added to the FAQ, connect it to the [Chapter 8 responsibility table and contract boundaries](reference/08-language-runtime-and-device-boundaries.md). Link design rationale to the relevant section and the [original-document index](reference/07-semantic-rules-and-index.md#78-원문에서-reference로-찾아가기). This reference is one document set. Do not split its meaning by creating independently maintained copies in other projects.
