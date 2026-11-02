import SensorStateSource

namespace BoolTranslation.EpochSource
open SourceReader SensorSourceReader SensorStateSource SensorStateProfile

structure ParsedSource where
  stateSource : SensorStateSource.ParsedSource
  timer : List Nat
  timerNode : Nat
  deriving DecidableEq, Repr

def timerDeclaration : SensorSourceReader.Parser (String × String × Nat) := do
  token "timer"
  let timer ← name
  token "="; token "elapsed"; token "("
  let state ← name
  let _stateReference ← fresh
  token ")"
  let _call ← fresh
  token ";"
  let timerNode ← fresh
  pure (timer, state, timerNode)

def program : SensorSourceReader.Parser ParsedSource := do
  let moduleName ← header
  let (sensor, origin) ← sensorDeclaration
  let (state, initial) ← stateDeclaration
  let output ← outputDeclaration
  let (target, input, yes, no, site) ← transition
  let (destination, candidate) ← SensorStateSource.connection
  let (timer, timerState, timerNode) ← timerDeclaration
  token "}"
  let p : SensorStateProfile.Profile :=
    ⟨SourceReader.ascii moduleName, SourceReader.ascii sensor, SourceReader.ascii state,
      initial, SourceReader.ascii output⟩
  if target = state ∧ input = sensor ∧ yes = state ∧ no = state ∧
      destination = output ∧ candidate = state ∧ timerState = state ∧
      SensorStateProfile.valid p = true ∧ ([sensor, state, output, timer].Nodup) then
    pure ⟨⟨p, origin, site⟩, SourceReader.ascii timer, timerNode⟩
  else fun _ => none

def readSource (raw : SourceBytes) : Option ParsedSource := do
  let bytes := raw.map UInt8.toNat
  if bytes.length > 65536 || !validUTF8 bytes || bytes.contains 13 then none else do
    let code ← envelope false (lines bytes)
    let tokens ← lex (code.length + 1) code
    let (parsed, rest) ← program ⟨tokens, 1⟩
    if rest.tokens = [] ∧ parsed.stateSource.origin = 1 ∧ parsed.stateSource.site = 7 ∧
        parsed.timerNode = 18 then some parsed else none

def sinceName (p : ParsedSource) : List Nat := SensorProfile.ascii "__gf_timer_since_" ++ p.timer
def initializedName (p : ParsedSource) : List Nat := SensorProfile.ascii "__gf_timer_initialized_" ++ p.timer

structure TimerBinding where
  node : Nat
  kind : List Nat
  name : List Nat
  fields : List (List Nat)
  declaration : List Nat
  role : List Nat
  deriving DecidableEq

structure TimerMeta where
  name : List Nat
  state : List Nat
  clock : List Nat
  deriving DecidableEq

abbrev Metadata := SensorProfile.Metadata × List TimerBinding × List TimerMeta

def metadataOf (p : ParsedSource) : Metadata :=
  (SensorStateSource.metadataOf p.stateSource,
    [⟨p.timerNode, SensorProfile.ascii "timer", sinceName p,
       [SensorProfile.ascii "stateBefore", SensorProfile.ascii "stateAfter"], p.timer, SensorProfile.ascii "since"⟩,
     ⟨p.timerNode, SensorProfile.ascii "timer", initializedName p,
       [SensorProfile.ascii "stateBefore", SensorProfile.ascii "stateAfter"], p.timer, SensorProfile.ascii "initialized"⟩],
    [⟨p.timer, p.stateSource.profile.state, SensorProfile.ascii "__gf_now_ms"⟩])

end BoolTranslation.EpochSource
