import ClockBounds

namespace BoolTranslation.DurationSource
open SourceReader SensorSourceReader SensorStateSource

structure ParsedSource where
  epoch : EpochSource.ParsedSource
  duration : List Nat
  declaration : Nat
  connection : Nat
  deriving DecidableEq, Repr

def durationDeclaration : SensorSourceReader.Parser (String × Nat) := do
  token "output"
  let output ← name
  token ":"; token "Duration"; token ";"
  let node ← fresh
  pure (output, node)

def durationConnection : SensorSourceReader.Parser (String × String × Nat) := do
  let output ← name
  token "<-"
  let timer ← name
  let _reference ← fresh
  token ";"
  let node ← fresh
  pure (output, timer, node)

def program : SensorSourceReader.Parser ParsedSource := do
  let moduleName ← header
  let (sensor, origin) ← sensorDeclaration
  let (state, initial) ← stateDeclaration
  let output ← outputDeclaration
  let (target, input, yes, no, site) ← transition
  let (destination, candidate) ← SensorStateSource.connection
  let (timer, timerState, timerNode) ← EpochSource.timerDeclaration
  let (duration, declaration) ← durationDeclaration
  let (durationTarget, timerRead, connectionNode) ← durationConnection
  token "}"
  let p : SensorStateProfile.Profile :=
    ⟨ascii moduleName, ascii sensor, ascii state, initial, ascii output⟩
  if target = state ∧ input = sensor ∧ yes = state ∧ no = state ∧ destination = output ∧
      candidate = state ∧ timerState = state ∧ durationTarget = duration ∧ timerRead = timer ∧
      SensorStateProfile.valid p = true ∧ ([sensor, state, output, timer, duration].Nodup) then
    pure ⟨⟨⟨p, origin, site⟩, ascii timer, timerNode⟩, ascii duration, declaration, connectionNode⟩
  else fun _ => none

def readSource (raw : SourceBytes) : Option ParsedSource := do
  let bytes := raw.map UInt8.toNat
  if bytes.length > 65536 || !validUTF8 bytes || bytes.contains 13 then none else do
    let code ← envelope false (lines bytes)
    let tokens ← lex (code.length + 1) code
    let (parsed, rest) ← program ⟨tokens, 1⟩
    if rest.tokens = [] ∧ parsed.epoch.stateSource.origin = 1 ∧ parsed.epoch.stateSource.site = 7 ∧
        parsed.epoch.timerNode = 18 ∧ parsed.declaration = 19 ∧ parsed.connection = 21 then
      some parsed else none

structure OutputMeta where
  name : List Nat
  type : List Nat
  deriving DecidableEq

structure Connection where
  node : Nat
  kind : List Nat
  name : List Nat
  fields : List (List Nat)
  deriving DecidableEq

structure Dependency where
  field : List Nat
  name : List Nat
  reads : List (List Nat × List Nat)
  deriving DecidableEq

abbrev Metadata := EpochSource.Metadata × List OutputMeta × List Connection × List Dependency

def metadataOf (p : ParsedSource) : Metadata :=
  (EpochSource.metadataOf p.epoch,
    [⟨p.epoch.stateSource.profile.output, ascii "Bool"⟩, ⟨p.duration, ascii "Duration"⟩],
    [⟨15, ascii "connection", p.epoch.stateSource.profile.output, [ascii "requested", ascii "safe"]⟩,
     ⟨p.connection, ascii "connection", p.duration, [ascii "requested", ascii "safe"]⟩],
    [⟨ascii "requested", p.epoch.stateSource.profile.output,
       [(ascii "stateAfter", p.epoch.stateSource.profile.state)]⟩,
     ⟨ascii "requested", p.duration,
       [(ascii "stateBefore", EpochSource.initializedName p.epoch),
        (ascii "inputs", ascii "__gf_now_ms"), (ascii "stateBefore", EpochSource.sinceName p.epoch)]⟩])

end BoolTranslation.DurationSource
