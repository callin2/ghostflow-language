import ClockBounds

namespace BoolTranslation.ComparisonSource
open SourceReader SensorSourceReader SensorStateSource

def lexComparison : Nat → List Nat → Option (List String)
  | 0, _ => none
  | _ + 1, [] => some []
  | fuel + 1, b :: rest =>
    if b = 32 || b = 10 || b = 9 then lexComparison fuel rest else
    if b = 47 && rest.head? = some 47 then lexComparison fuel (rest.dropWhile (· != 10)) else
    if digit b then do
      let tail := rest.takeWhile nameTail
      let tokens ← lexComparison fuel (rest.drop tail.length)
      pure (tokenString (b :: tail) :: tokens)
    else if letter b then do
      let tail := rest.takeWhile nameTail
      let tokens ← lexComparison fuel (rest.drop tail.length)
      pure (tokenString (b :: tail) :: tokens)
    else if (b = 38 && rest.head? = some 38) || (b = 124 && rest.head? = some 124) ||
        (b = 60 && rest.head? = some 45) || (b = 62 && rest.head? = some 61) || (b = 124 && rest.head? = some 62) then do
      let tokens ← lexComparison fuel rest.tail
      pure (tokenString [b, rest.head!] :: tokens)
    else if [123, 125, 40, 41, 58, 59, 61, 39, 33].contains b then do
      let tokens ← lexComparison fuel rest
      pure (tokenString [b] :: tokens)
    else none

structure ParsedSource where
  epoch : EpochSource.ParsedSource
  comparison : List Nat
  declaration : Nat
  connection : Nat
  deriving DecidableEq, Repr

def comparisonDeclaration : SensorSourceReader.Parser (String × Nat) := do
  token "output"
  let output ← name
  token ":"; token "Bool"; token ";"
  let node ← fresh
  pure (output, node)

def comparisonConnection : SensorSourceReader.Parser (String × String × Nat) := do
  let output ← name
  token "<-"
  let timer ← name
  let _reference ← fresh
  token ">="; token "3000ms"
  let _literal ← fresh
  let _comparison ← fresh
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
  let (comparison, declaration) ← comparisonDeclaration
  let (comparisonTarget, timerRead, connectionNode) ← comparisonConnection
  token "}"
  let p : SensorStateProfile.Profile :=
    ⟨ascii moduleName, ascii sensor, ascii state, initial, ascii output⟩
  if target = state ∧ input = sensor ∧ yes = state ∧ no = state ∧ destination = output ∧
      candidate = state ∧ timerState = state ∧ comparisonTarget = comparison ∧ timerRead = timer ∧
      SensorStateProfile.valid p = true ∧ ([sensor, state, output, timer, comparison].Nodup) then
    pure ⟨⟨⟨p, origin, site⟩, ascii timer, timerNode⟩, ascii comparison, declaration, connectionNode⟩
  else fun _ => none

def readSource (raw : SourceBytes) : Option ParsedSource := do
  let bytes := raw.map UInt8.toNat
  if bytes.length > 65536 || !validUTF8 bytes || bytes.contains 13 then none else do
    let code ← envelope false (lines bytes)
    let tokens ← lexComparison (code.length + 1) code
    let (parsed, rest) ← program ⟨tokens, 1⟩
    if rest.tokens = [] ∧ parsed.epoch.stateSource.origin = 1 ∧ parsed.epoch.stateSource.site = 7 ∧
        parsed.epoch.timerNode = 18 ∧ parsed.declaration = 19 ∧ parsed.connection = 23 then
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
    [⟨p.epoch.stateSource.profile.output, ascii "Bool"⟩, ⟨p.comparison, ascii "Bool"⟩],
    [⟨15, ascii "connection", p.epoch.stateSource.profile.output, [ascii "requested", ascii "safe"]⟩,
     ⟨p.connection, ascii "connection", p.comparison, [ascii "requested", ascii "safe"]⟩],
    [⟨ascii "requested", p.epoch.stateSource.profile.output,
       [(ascii "stateAfter", p.epoch.stateSource.profile.state)]⟩,
     ⟨ascii "requested", p.comparison,
       [(ascii "stateBefore", EpochSource.initializedName p.epoch),
        (ascii "inputs", ascii "__gf_now_ms"), (ascii "stateBefore", EpochSource.sinceName p.epoch)]⟩])

end BoolTranslation.ComparisonSource
