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

Imagine a pump has stopped at four in the morning. The person who wrote the program can't be reached, and someone on site has to find the cause.

That person needs a program that helps them understand why the equipment stopped, where to look, and what they can change. If someone has to remember details that the code alone can't tell you, you end up having to call that person again.

There's a standard I kept coming back to while designing GhostFlow.

**Even at four in the morning, you should be able to read and fix it on site.**

At first, I wanted to make the control work I'd been doing with PLCs a little easier on inexpensive MCUs. But making a relay turn on when you press a switch wasn't enough. You still needed to understand the reasons behind the behavior over time, keep using existing work when the equipment changed, and let someone else take over even when the original author wasn't there.

The principles below are choices that came out of that process.

### 1. Keep the reason for the code alongside the code

“Open the valve, then turn on the pump three seconds later.”

That might be what the code says. But why wait three seconds? Is that how long the valve takes to open, a margin for the piping, or just a number someone put in to try things out? Without knowing that, it's hard to judge whether you can shorten those three seconds to one.

That's why GhostFlow puts explanation and code in a single `.ghost.md` document. Alongside what the code does, you leave a record of why you chose that behavior and what equipment and conditions it assumes, connected to the relevant code. When making changes later, you should also be able to trace which explanation the code was based on and what changed in which revision.

The more code AI writes, the more important this distinction becomes. What a user actually asked for is different from a guess AI made to fill in a gap. An unconfirmed assumption should remain an assumption. Adding a plausible explanation doesn't turn it into the user's intent.

### 2. Deciding to turn on a pump is different from knowing it turned on

Even if a program says to turn on a pump, the pump might not run if the power is disconnected or the device has a problem. When a screen says ON, we need to distinguish a request to turn it on from confirmation that it is actually running.

GhostFlow takes inputs and computes which actions to request. Which ports and devices those requests connect to is written in the connection configuration, called binding, and the Driver handles the actual hardware. A rule like “stop the pump if there isn't enough water” doesn't need a particular board's pin numbers mixed into it.

With these responsibilities separated, you can test the same rules with virtual switches and lamps, then connect them to real devices later. You can also design runs that compare behavior without sending any real outputs. But a request produced in a virtual run and equipment operating correctly in the field remain separate things to verify throughout.

### 3. You should be able to see what is remembered and how it changes next

For a motor to keep running after you release the start button, something has to remember that the button was pressed. A program that opens valves in sequence also needs to know which valve it is currently using.

That memory belongs in `state`. Functions compute from the values they receive, while state carries the memory needed from one operation to the next. I don't want calling a function to secretly change a value somewhere else.

What matters to me is **a structure where you can read the next state directly from the current state and inputs**. If the reader has to run through the execution order several times in their head just to understand it, fixing it on site will be even harder. When a computed result is fed back into a decision, the state it passes through before the next computation should also be clear.

### 4. You should be able to check yesterday's decision again today

“Why did it ask to turn on the pump at three yesterday afternoon?”

If you've recorded the inputs, previous state, effective settings, and time conditions from that moment, you should be able to get the same decision under the same conditions. That lets you investigate the cause without relying only on memory or guesswork. After changing the program, you can also supply the same conditions and compare what changes.

To make this possible, a tick, which is one control computation, uses the same set of inputs and previous state throughout. The next states are committed together after computation finishes. The result shouldn't depend on which line of code ran first or whether a function secretly read the clock. You should also be able to tell which computation a settings change took effect from.

AI can help write a program, but I don't want each operating decision to depend on a new answer from AI. On site, the equipment should follow verified rules under defined execution conditions, and we should be able to retrace those decisions later. The device should also be able to keep carrying out its basic control locally without waiting for the internet or an AI response.

### 5. Don't make people guess the units every time they read a number

If a setting just says `10`, you have to dig through the surrounding code to find out whether it means ten times, ten seconds, or ten percent. A meaning that seemed obvious when you wrote it might be hard to remember a few months later.

GhostFlow treats counts, time, percentages, and physical quantities as distinct. It also distinguishes counts that need exact integers from numbers that handle approximate values, such as measurements. The idea is to let the language check what values mean instead of relying only on variable names.

When converting units or converting a decimal value to an integer, the conversion, the point at which rounding happened, and what was discarded should all be visible. I'd like the language to catch some of the mistakes that otherwise only careful reading can prevent.

### 6. Decisions need to continue during those ten minutes of watering

“Water at 6 a.m.,” “water for ten minutes,” and “keep today's total watering time within thirty minutes” are different requirements. If you lump them into one timer just because they all concern time, interpretations can start to diverge as soon as you stop partway through and start again.

GhostFlow distinguishes the time to start, continuously elapsed time, accumulated usage time, and recurring periods. It also needs to record which schedule occurrence happened, so that receiving the same occurrence again can be distinguished from a new one. The time shown by a clock and the basis for measuring elapsed time are separate too.

Above all, waiting ten minutes mustn't mean the program stops making other decisions. It needs to keep checking whether the stop button has been pressed or the water has run low. Conditions like “one hour after sunrise” should also be expressible, but what to do when the sunrise time can't be obtained needs to be specified separately.

### 7. If a value is unknown, keep that fact visible

A temperature of zero degrees is different from being unable to read the temperature sensor. Having a last-read value is also different from being able to trust and use that value now.

We distinguish a value that isn't available yet, a value that is too old, or a failed read from a normal value. Being unable to obtain the sunrise time mustn't be treated as “the scheduled time hasn't arrived yet,” either. If an unknown situation is simply turned into zero or false, later decisions have no way to tell what went wrong.

The fallback rule for such a situation needs to be explicit and suited to the installation's conditions. Even if computation continues with a substitute value, we need to keep a record of what information was originally missing, why this approach was chosen, and when things returned to normal.

### 8. Distinguish what you want to do from what you are allowed to do

An irrigation program might want to turn on a pump while the water tank is empty. Two programs might want to use the same pump, or a device might have forward and reverse outputs that mustn't be turned on together.

Copying these conditions into different places in each program makes it easy to leave one out or later change only one copy. That's why we treat each program's requests separately from the conditions that govern what the installation as a whole allows. Outputs that can't be on together, rules for shared resources, what each mode permits, and operating time limits should be visible. When a request is blocked, we should be able to tell which condition blocked it.

Showing the user only “pump OFF” isn't enough. They should be able to follow the explanation all the way to “it was time to water, but the pump wasn't turned on because of the low-water input.” That's why I want even non-specialists to be able to ask about the reasons behind behavior in their own words and check the answers. Explanations should follow the evidence from execution, rather than adding a plausible story afterward.

Of course, constraints in a program don't replace physical safety devices. Responsibilities that belong in hardware, such as emergency stops and electrical protection, remain separate.

### 9. You shouldn't have to rewrite a program just to change the watering time

With a program that “waters for ten minutes every hour,” you might want to reduce it to seven minutes today. If that means changing the control code too, it won't be convenient for everyday use.

Values that can be adjusted during operation are declared separately as settings. We record their names, types, defaults, allowed ranges, and permissions together, and make it clear when changed values take effect. Changing settings, changing the control rules themselves, and forcibly overwriting internal state are different things.

Screens should be able to use this information too. For a time setting, that might mean creating a time input tool and helping people stay within the allowed range. I like screens that feel as if the switches and dials from an existing control cabinet have been moved onto them, but they don't have to look that way. The same settings could be presented differently on a phone. **Even when the screen looks different, the controls should keep the same meaning.**

### 10. If you've found two good examples, you should be able to use them together

There's an irrigation control example and a ventilation fan control example. Each works well on its own. But if using them together on one board means taking both programs apart and rewriting them, someone who's not comfortable coding can get stuck right there.

I found this particularly frustrating. If irrigation needs two inputs and three outputs, and ventilation needs four outputs, I wanted to be able to take each program and use it by connecting devices to the inputs and outputs it needs.

That doesn't mean matching the number of inputs and outputs is enough. We need to check whether the programs share resources, whether their constraints conflict, and whether their states stay separate. We should also be able to trace the original code and its revision, along with the devices currently connected to it.

I also try to keep in mind that these programs will run on small MCUs. A combination might look simple, but it would be a problem if its computation never finished or the values it needed to remember kept growing. Even after composition, we should be able to assess how much memory and computation it needs. I want both the convenience of reusing someone else's work and the conditions that let you take responsibility for running it on your own equipment.

## Perspectives that influenced the design

GhostFlow carries influences from tools I've enjoyed using. Rather than copying their syntax, I tried to bring over what made them convenient and easy to understand.

What I liked about **Literate CoffeeScript** was reading explanation and code in one document. You can describe how the equipment should behave and put the code where it's needed. Rather than requiring a separate, well-written manual, I wanted explanation and code to be together from the start.

**ObservableHQ** influenced me not only through the way connected computations and displays update when a value changes, but also through the way you can take someone else's notebook and use it as part of your own work. What mattered was being able to use a well-made result as material for the next piece of work, rather than just looking at it. Looking at **marimo and D3.js**, I also valued keeping code and results together and seeing the relationships between values and changes.

From **functional programming**, I took the idea of composing small computations without hiding memory or side effects. From **Cycle.js**, I took the perspective of separating receiving inputs, producing output requests, and the Driver that creates actual effects. These connect to the choices to keep state, computation, and hardware distinct.

**Elm and Rust** influenced the approach of using type and branch checks to catch problems before they appear at runtime. What I valued in **railway-oriented programming** was similar: you should be able to read the failure paths in the code, as well as the normal results.

From **YAML**, I drew on declarations that expose the structure of names and settings. From **Cypher**, I drew on selecting things by their properties and capabilities rather than their location. What interested me in **Meta Lua** was the possibility of treating code as data and extending it. Even when extending the forms of expression, though, it should still be possible to check what the code means and how far its effects reach.

In the end, these preferences all point in the same direction. **I don't want what we understood while building something to be lost when we fix it or hand it over.** Whether a person writes it or AI helps, the person left on site needs to be able to read the program and make a judgment.

This section describes the design criteria GhostFlow aims for. How much of each feature has been implemented, and what has been verified on actual devices, need to be checked separately.

## Rules for maintaining this reference

When language semantics change, update the relevant chapter's **syntax, rules, examples, and Why** together. When a new requirement is added to the FAQ, connect it to the [Chapter 8 responsibility table and contract boundaries](reference/08-language-runtime-and-device-boundaries.md). Link design rationale to the relevant section and the [original-document index](reference/07-semantic-rules-and-index.md#78-원문에서-reference로-찾아가기). This reference is one document set. Do not split its meaning by creating independently maintained copies in other projects.
