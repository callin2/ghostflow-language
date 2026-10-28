import SensorSourceReader
import SensorStateProfile

namespace BoolTranslation.SensorStateSource

open SourceReader SensorSourceReader SensorMachine SensorStateMachine SensorStateProfile

structure ParsedSource where
  profile : SensorStateProfile.Profile
  origin : Nat
  site : Nat
  deriving DecidableEq, Repr

def initialBool : SensorSourceReader.Parser Bool := do
  let value ← consume fun tokens => match tokens with
    | "true" :: rest => some (true, rest)
    | "false" :: rest => some (false, rest)
    | _ => none
  let _literal ← fresh
  pure value

def stateDeclaration : SensorSourceReader.Parser (String × Bool) := do
  token "state"
  let state ← name
  token ":"; token "Bool"; token "="
  let initial ← initialBool
  token ";"
  let _stateNode ← fresh
  pure (state, initial)

def recoveryTest : SensorSourceReader.Parser (String × Nat) := do
  token "if"; token "("
  let sensor ← name
  let _inputReference ← fresh
  token "|>"
  let site ← recovery
  let _pipe ← fresh
  token ")"
  pure (sensor, site)

def stateBranches : SensorSourceReader.Parser (String × String) := do
  token "then"; token "!"
  let yes ← name
  let _yesReference ← fresh
  let _negation ← fresh
  token "else"
  let no ← name
  let _noReference ← fresh
  let _ifNode ← fresh
  token ";"
  let _transitionNode ← fresh
  pure (yes, no)

def transition : SensorSourceReader.Parser (String × String × String × String × Nat) := do
  let target ← name
  token "'"; token "="
  let (sensor, site) ← recoveryTest
  let (yes, no) ← stateBranches
  pure (target, sensor, yes, no, site)

def connection : SensorSourceReader.Parser (String × String) := do
  let target ← name
  token "<-"
  let state ← name
  token "'"
  let _candidateReference ← fresh
  token ";"
  let _connectionNode ← fresh
  pure (target, state)

def program : SensorSourceReader.Parser ParsedSource := do
  let moduleName ← header
  let (sensor, origin) ← sensorDeclaration
  let (state, initial) ← stateDeclaration
  let output ← outputDeclaration
  let (target, input, yes, no, site) ← transition
  let (destination, candidate) ← connection
  token "}"
  let p : SensorStateProfile.Profile :=
    ⟨SourceReader.ascii moduleName, SourceReader.ascii sensor, SourceReader.ascii state,
      initial, SourceReader.ascii output⟩
  if target = state ∧ input = sensor ∧ yes = state ∧ no = state ∧
      destination = output ∧ candidate = state ∧ SensorStateProfile.valid p = true then
    pure ⟨p, origin, site⟩
  else fun _ => none

def readSource (raw : SourceBytes) : Option ParsedSource := do
  let bytes := raw.map UInt8.toNat
  if bytes.length > 65536 || !validUTF8 bytes || bytes.contains 13 then none else do
    let code ← envelope false (lines bytes)
    let tokens ← lex (code.length + 1) code
    let (parsed, rest) ← program ⟨tokens, 1⟩
    if rest.tokens = [] ∧ parsed.origin = 1 ∧ parsed.site = 7 then some parsed else none

theorem readSource_ids (source : SourceBytes) (parsed : ParsedSource)
    (h : readSource source = some parsed) : parsed.origin = 1 ∧ parsed.site = 7 := by
  unfold readSource at h
  dsimp only at h
  split at h
  · contradiction
  · obtain ⟨code, _, h⟩ := Option.bind_eq_some.mp h
    obtain ⟨tokens, _, h⟩ := Option.bind_eq_some.mp h
    obtain ⟨⟨result, rest⟩, _, h⟩ := Option.bind_eq_some.mp h
    dsimp only at h
    split at h
    · rename_i accepted
      simp only [Option.some.injEq] at h
      subst result
      exact accepted.2
    · contradiction

def metadataOf (p : ParsedSource) : SensorProfile.Metadata :=
  ([⟨p.profile.sensor, SensorProfile.ascii "Bool", SensorProfile.railNames (sensorProfile p.profile)⟩],
    [⟨p.site, p.site, SensorProfile.ascii "recover", SensorProfile.ascii "SensorFault",
      [⟨p.origin, p.origin, SensorProfile.ascii "sensor", p.profile.sensor⟩]⟩])

theorem metadata_expected (source : SourceBytes) (p : ParsedSource)
    (h : readSource source = some p) : metadataOf p = expectedMetadata p.profile := by
  obtain ⟨origin, site⟩ := readSource_ids source p h
  simp [metadataOf, expectedMetadata, origin, site]

def sourceObservation (source : SourceBytes) (inputs : List ScanInput) : Option (List ScanObservation) := do
  let parsed ← readSource source
  pure (sourceTrace parsed.profile.initial inputs)

def observeModule (ops : NumberOps N) (raw : List Nat) (metadata : SensorProfile.Metadata)
    (inputs : List ScanInput) : Option (List ScanObservation) := do
  let loaded ← SensorStateProfile.load raw
  if metadata = expectedMetadata loaded.profile then
    rawTrace ops loaded.transition loaded.output loaded.profile.initial inputs
  else none

theorem original_source_input_trace (source : SourceBytes) (parsed : ParsedSource)
    (raw : List Nat) (metadata : SensorProfile.Metadata)
    (sourceRead : readSource source = some parsed)
    (rawLoad : SensorStateProfile.load raw = some ⟨parsed.profile, transitionCode, outputCode⟩)
    (metadataBound : metadata = metadataOf parsed)
    (ops : NumberOps N) (laws : SmallNumberLaws ops) (inputs : List ScanInput) :
    observeModule ops raw metadata inputs = sourceObservation source inputs := by
  have bound : metadata = expectedMetadata parsed.profile :=
    metadataBound.trans (metadata_expected source parsed sourceRead)
  simp [observeModule, sourceObservation, sourceRead, rawLoad, bound, input_trace ops laws]

#print axioms readSource_ids
#print axioms metadata_expected
#print axioms original_source_input_trace
end BoolTranslation.SensorStateSource
