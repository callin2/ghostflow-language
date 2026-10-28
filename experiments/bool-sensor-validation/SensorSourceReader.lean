import SourceReader
import SensorProfile

namespace BoolTranslation.SensorSourceReader

open SourceReader SensorMachine SensorProfile

def words : List Nat → List (List Nat)
  | [] => [[]]
  | b :: rest =>
    let tail := words rest
    if b = 32 then [] :: tail else
    match tail with
    | word :: more => (b :: word) :: more
    | [] => [[b]]

def field (label : String) (bytes : List Nat) : Option (List Nat) :=
  let key := SourceReader.ascii label
  if bytes.take key.length = key then some (bytes.drop key.length) else none

def anchorId (bytes : List Nat) : Bool :=
  bytes.length ≤ 128 && match bytes with
  | b :: rest => (SourceReader.letter b && b != 95) &&
      rest.all (fun c => SourceReader.nameTail c || [46, 58, 45].contains c)
  | [] => false

def anchor (line : List Nat) : Bool :=
  match words line with
  | [opening, tag, idField, kindField, statusField, originField, closing] =>
    opening == SourceReader.ascii "<!--" && tag == SourceReader.ascii "ghostflow:anchor" &&
    closing == SourceReader.ascii "-->" &&
    match field "id=" idField, field "kind=" kindField, field "status=" statusField, field "origin=" originField with
    | some id, some kind, some status, some origin =>
      anchorId id && (["intent", "premise", "assumption"].map SourceReader.ascii).contains kind &&
      (["confirmed", "unconfirmed", "superseded"].map SourceReader.ascii).contains status &&
      (["user", "operator", "engineer", "ai", "imported"].map SourceReader.ascii).contains origin
    | _, _, _, _ => false
  | _ => false

def quotedIntent : List Nat → Bool
  | 62 :: 32 :: b :: rest => SourceReader.safeProse (b :: rest)
  | _ => false

def envelope (anchorSeen : Bool) : List (List Nat) → Option (List Nat)
  | [] => none
  | line :: rest =>
    if line = SourceReader.ascii "```ghost" then SourceReader.extract true false rest else
    if SourceReader.safeProse line then envelope anchorSeen rest else
    if !anchorSeen && anchor line then
      match rest with
      | quote :: [] :: tail => if quotedIntent quote then envelope true tail else none
      | _ => none
    else none

structure ParsedSource where
  profile : Profile
  origin : Nat
  site : Nat
  deriving DecidableEq, Repr

structure Cursor where
  tokens : List String
  nextNode : Nat

abbrev Parser (α : Type) := StateT Cursor Option α

def consume (read : SourceReader.Parser α) : Parser α := fun cursor => do
  let (value, rest) ← read cursor.tokens
  pure (value, { cursor with tokens := rest })

def fresh : Parser Nat := fun cursor => some (cursor.nextNode, { cursor with nextNode := cursor.nextNode + 1 })

def name : Parser String := do
  let value ← consume SourceReader.readName
  if ["restart_reason", "restart_event"].contains value then fun _ => none else pure value

def token (value : String) : Parser Unit := consume (SourceReader.expect value)

def header : Parser String := do
  token "control"
  let moduleName ← name
  token "{"
  pure moduleName

def sensorDeclaration : Parser (String × Nat) := do
  token "input"
  let sensor ← name
  token ":"; token "Bool"; token ";"
  let origin ← fresh
  pure (sensor, origin)

def outputDeclaration : Parser String := do
  token "output"
  let output ← name
  token ":"; token "Bool"; token ";"
  let _outputNode ← fresh
  pure output

def recovery : Parser Nat := do
  token "recover"; token "("; token "false"
  let _literalNode ← fresh
  token ")"
  fresh

def connection : Parser (String × String × Nat) := do
  let target ← name
  token "<-"
  let source ← name
  let _referenceNode ← fresh
  token "|>"
  let site ← recovery
  let _pipeNode ← fresh
  token ";"
  let _connectionNode ← fresh
  pure (target, source, site)

def program : Parser ParsedSource := do
  let moduleName ← header
  let (sensor, origin) ← sensorDeclaration
  let output ← outputDeclaration
  let (target, source, site) ← connection
  token "}"
  let profile : Profile := ⟨SourceReader.ascii moduleName, SourceReader.ascii sensor, SourceReader.ascii output⟩
  if target = output ∧ source = sensor ∧ valid profile = true then
    pure ⟨profile, origin, site⟩
  else fun _ => none

def readSource (raw : SourceBytes) : Option ParsedSource := do
  let bytes := raw.map UInt8.toNat
  if bytes.length > 65536 || !validUTF8 bytes || bytes.contains 13 then none else do
    let code ← envelope false (lines bytes)
    let tokens ← lex (code.length + 1) code
    let (parsed, rest) ← program ⟨tokens, 1⟩
    if rest.tokens = [] ∧ parsed.origin = 1 ∧ parsed.site = 5 then some parsed else none

theorem readSource_ids (source : SourceBytes) (parsed : ParsedSource)
    (h : readSource source = some parsed) : parsed.origin = 1 ∧ parsed.site = 5 := by
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

def metadataOf (parsed : ParsedSource) : Metadata :=
  ([⟨parsed.profile.sensor, SensorProfile.ascii "Bool", railNames parsed.profile⟩],
    [⟨parsed.site, parsed.site, SensorProfile.ascii "recover", SensorProfile.ascii "SensorFault",
      [⟨parsed.origin, parsed.origin, SensorProfile.ascii "sensor", parsed.profile.sensor⟩]⟩])

theorem metadata_expected (parsed : ParsedSource) (origin : parsed.origin = 1) (site : parsed.site = 5) :
    metadataOf parsed = expectedMetadata parsed.profile := by
  simp [metadataOf, expectedMetadata, origin, site]

def sourceObservation (source : SourceBytes) (reading : Reading) : Option Observation := do
  let _ ← readSource source
  pure (observed reading)

theorem loaded_observation (source : SourceBytes) (parsed : ParsedSource) (raw : List Nat)
    (metadata : Metadata) (read : readSource source = some parsed)
    (loaded : SensorProfile.load raw = some ⟨parsed.profile, recoverCode⟩)
    (bound : metadata = metadataOf parsed)
    (ops : NumberOps N) (laws : SmallNumberLaws ops) (reading : Reading) (stalePayload : Bool) :
    observeModule ops raw metadata (rails ops reading stalePayload) = sourceObservation source reading := by
  have ids := readSource_ids source parsed read
  have expected : metadata = expectedMetadata parsed.profile := bound.trans (metadata_expected parsed ids.1 ids.2)
  rw [SensorProfile.loaded_observation ops laws raw _ metadata loaded expected reading stalePayload]
  simp [sourceObservation, read]

#print axioms metadata_expected
#print axioms readSource_ids
#print axioms loaded_observation

end BoolTranslation.SensorSourceReader
