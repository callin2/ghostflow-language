import ModuleLoader

namespace BoolTranslation.SourceReader

open ModuleEnvelope

abbrev SourceBytes := List UInt8

def continuation (b : Nat) : Bool := 128 ≤ b && b ≤ 191

def validUTF8 : List Nat → Bool
  | [] => true
  | a :: rest =>
    if a < 128 then validUTF8 rest else
    match rest with
    | b :: tail =>
      if 194 ≤ a && a ≤ 223 then continuation b && validUTF8 tail else
      match tail with
      | c :: tail =>
        if 224 ≤ a && a ≤ 239 then
          continuation b && continuation c &&
          (a != 224 || 160 ≤ b) && (a != 237 || b ≤ 159) && validUTF8 tail else
        match tail with
        | d :: tail =>
          240 ≤ a && a ≤ 244 && continuation b && continuation c && continuation d &&
          (a != 240 || 144 ≤ b) && (a != 244 || b ≤ 143) && validUTF8 tail
        | _ => false
      | _ => false
    | _ => false

def lines : List Nat → List (List Nat)
  | [] => [[]]
  | b :: rest =>
    let tail := lines rest
    if b = 10 then [] :: tail else
    match tail with
    | line :: more => (b :: line) :: more
    | [] => [[b]]

def ascii (s : String) : List Nat := s.toUTF8.data.toList.map UInt8.toNat

def letter (b : Nat) : Bool := 65 ≤ b && b ≤ 90 || 97 ≤ b && b ≤ 122 || b = 95
def digit (b : Nat) : Bool := 48 ≤ b && b ≤ 57

def safeProse (line : List Nat) : Bool :=
  line.all (fun b => b ≥ 32 && b != 60 && b != 62 && b != 96 && b != 126) &&
  match line with
  | [] => true
  | 35 :: 32 :: _ => true
  | b :: _ => letter b || b ≥ 128

def extract (inside closed : Bool) : List (List Nat) → Option (List Nat)
  | [] => if closed then some [] else none
  | line :: rest =>
    if inside then
      if line = ascii "```" then extract false true rest else
      if line.any (fun b => b = 96 || b = 126) then none else do
        let tail ← extract true false rest
        pure (line ++ [10] ++ tail)
    else if !closed && line = ascii "```ghost" then extract true false rest
    else if safeProse line then extract false closed rest else none

def nameTail (b : Nat) : Bool := letter b || digit b
def tokenString (bytes : List Nat) : String := String.mk (bytes.map Char.ofNat)

def lex : Nat → List Nat → Option (List String)
  | 0, _ => none
  | _ + 1, [] => some []
  | fuel + 1, b :: rest =>
    if b = 32 || b = 10 || b = 9 then lex fuel rest else
    if b = 47 && rest.head? = some 47 then lex fuel (rest.dropWhile (· != 10)) else
    if letter b then do
      let tail := rest.takeWhile nameTail
      let tokens ← lex fuel (rest.drop tail.length)
      pure (tokenString (b :: tail) :: tokens)
    else if (b = 38 && rest.head? = some 38) || (b = 124 && rest.head? = some 124) ||
        (b = 60 && rest.head? = some 45) then do
      let tokens ← lex fuel rest.tail
      pure (tokenString [b, rest.head!] :: tokens)
    else if [123, 125, 40, 41, 58, 59, 61, 39, 33].contains b then do
      let tokens ← lex fuel rest
      pure (tokenString [b] :: tokens)
    else none

inductive SurfaceExpr where
  | literal (value : Bool)
  | oldName (name : String)
  | candidateName (name : String)
  | neg (value : SurfaceExpr)
  | and (left right : SurfaceExpr)
  | or (left right : SurfaceExpr)
  | branch (condition yes no : SurfaceExpr)
  | grouped (value : SurfaceExpr)
  deriving Repr, DecidableEq

def reserved : List String := ["control", "state", "output", "Bool", "true", "false",
  "if", "then", "else", "import", "config", "input", "constraint"]
def isName (s : String) : Bool :=
  match ascii s with
  | b :: rest => letter b && rest.all nameTail && !(reserved.contains s) &&
      !((b :: rest).take 5 == [95, 95, 103, 102, 95])
  | [] => false

abbrev Parser (α : Type) := StateT (List String) Option α
def expect (s : String) : Parser Unit
  | t :: rest => if t = s then some ((), rest) else none
  | [] => none
def readName : Parser String
  | t :: rest => if isName t then some (t, rest) else none
  | [] => none

mutual
def expression : Nat → Nat → Parser SurfaceExpr
  | 0, _ => fun _ => none
  | fuel + 1, precedence => do
    let lhs ← atom fuel
    operators fuel precedence lhs
def atom : Nat → Parser SurfaceExpr
  | 0 => fun _ => none
  | fuel + 1 => fun tokens =>
    match tokens with
    | "true" :: rest => some (.literal true, rest)
    | "false" :: rest => some (.literal false, rest)
    | "!" :: rest => (atom fuel rest).map (fun (e, tail) => (.neg e, tail))
    | "(" :: rest => (do
        let e ← expression fuel 0
        expect ")"
        pure (SurfaceExpr.grouped e)) rest
    | "if" :: rest => (do
        let c ← expression fuel 0
        expect "then"
        let y ← expression fuel 0
        expect "else"
        let n ← expression fuel 0
        pure (SurfaceExpr.branch c y n)) rest
    | name :: "'" :: rest => if isName name then some (.candidateName name, rest) else none
    | name :: rest => if isName name then some (.oldName name, rest) else none
    | [] => none
def operators : Nat → Nat → SurfaceExpr → Parser SurfaceExpr
  | 0, _, _ => fun _ => none
  | fuel + 1, precedence, lhs => fun tokens =>
    match tokens with
    | "&&" :: rest =>
      if precedence ≤ 2 then (do
        let rhs ← expression fuel 3
        operators fuel precedence (.and lhs rhs)) rest
      else some (lhs, tokens)
    | "||" :: rest =>
      if precedence ≤ 1 then (do
        let rhs ← expression fuel 2
        operators fuel precedence (.or lhs rhs)) rest
      else some (lhs, tokens)
    | _ => some (lhs, tokens)
end

inductive Declaration where
  | state (name : String) (initial : Bool)
  | output (name : String)
  | next (name : String) (value : SurfaceExpr)
  | connect (name : String) (value : SurfaceExpr)
  deriving Repr

def declaration (fuel : Nat) : Parser Declaration := fun tokens =>
  match tokens with
  | "state" :: rest => (do
      let name ← readName
      expect ":"; expect "Bool"; expect "="
      let value ← fun ts => match ts with
        | "true" :: tail => some (true, tail)
        | "false" :: tail => some (false, tail)
        | _ => none
      expect ";"
      pure (Declaration.state name value)) rest
  | "output" :: rest => (do
      let name ← readName
      expect ":"; expect "Bool"; expect ";"
      pure (Declaration.output name)) rest
  | _ => (do
      let name ← readName
      let next ← fun ts => match ts with
        | "'" :: "=" :: rest => some (true, rest)
        | "<-" :: rest => some (false, rest)
        | _ => none
      let value ← expression fuel 0
      expect ";"
      pure (if next then Declaration.next name value else Declaration.connect name value)) tokens

def declarations : Nat → Parser (List Declaration)
  | 0 => fun _ => none
  | fuel + 1 => fun tokens =>
    match tokens with
    | "}" :: rest => some ([], rest)
    | _ => (do
        let head ← declaration fuel
        let tail ← declarations fuel
        pure (head :: tail)) tokens

def program (fuel : Nat) : Parser (String × List Declaration) := do
  expect "control"
  let name ← readName
  expect "{"
  let decls ← declarations fuel
  pure (name, decls)

def elaborateExpr (states : List String) (p : Bool) : SurfaceExpr → Option (Expr p)
  | .literal b => some (.literal b)
  | .oldName name => (states.findIdx? (· == name)).map Expr.previous
  | .candidateName name => if h : p = true then
      (states.findIdx? (· == name)).map (fun i => .next i h) else none
  | .neg e => (elaborateExpr states p e).map Expr.negate
  | .and a b => return conjunction (← elaborateExpr states p a) (← elaborateExpr states p b)
  | .or a b => return disjunction (← elaborateExpr states p a) (← elaborateExpr states p b)
  | .branch c y n => do
      let condition ← elaborateExpr states p c
      let yes ← elaborateExpr states p y
      let no ← elaborateExpr states p n
      pure (.branch condition yes no)
  | .grouped e => elaborateExpr states p e

def statesOf (ds : List Declaration) : List (String × Bool) := ds.filterMap fun d =>
  match d with | .state n b => some (n, b) | _ => none
def outputsOf (ds : List Declaration) : List String := ds.filterMap fun d =>
  match d with | .output n => some n | _ => none
def transitionsOf (ds : List Declaration) : List (String × SurfaceExpr) := ds.filterMap fun d =>
  match d with | .next n e => some (n, e) | _ => none
def connectionsOf (ds : List Declaration) : List (String × SurfaceExpr) := ds.filterMap fun d =>
  match d with | .connect n e => some (n, e) | _ => none
def unique (names : List String) : Bool := names.eraseDups.length = names.length

def elaborate (name : String) (ds : List Declaration) : Option Module := do
  let states := statesOf ds
  let names := states.map Prod.fst
  let outputs := outputsOf ds
  let transitions := transitionsOf ds
  let connections := connectionsOf ds
  if !(unique (names ++ outputs) && unique (transitions.map Prod.fst) &&
      unique (connections.map Prod.fst) && transitions.all (fun t => names.contains t.1) &&
      connections.all (fun c => outputs.contains c.1)) then none else do
    let next ← names.mapIdxM fun i n =>
      match transitions.find? (fun t => t.1 == n) with
      | some (_, e) => elaborateExpr names false e
      | none => some (.previous i)
    let values ← outputs.mapM fun n => do
      let (_, e) ← connections.find? (fun c => c.1 == n)
      let value ← elaborateExpr names true e
      pure (ascii n, value)
    let m : Module := ⟨ascii name, states.map (fun (n, b) => (ascii n, b)), next, values⟩
    if valid m then some m else none

def readSource (raw : SourceBytes) : Option Module := do
  let bytes := raw.map UInt8.toNat
  if bytes.length > 65536 || !validUTF8 bytes || bytes.contains 13 then none else do
    let code ← extract false false (lines bytes)
    let tokens ← lex (code.length + 1) code
    let ((name, ds), rest) ← program 1024 tokens
    if rest = [] then elaborate name ds else none

def sourceTrace (raw : SourceBytes) (n : Nat) : Option (List ModuleLoader.Observation) := do
  let m ← readSource raw
  pure (ModuleLoader.sourceTrace m n (m.states.map Prod.snd))

theorem initialized_trace (source : SourceBytes) (raw : List Nat) (m : Module)
    (read : readSource source = some m) (loaded : ModuleLoader.load raw = some m) (n : Nat) :
    ModuleLoader.trace raw n = sourceTrace source n := by
  rw [ModuleLoader.initialized_trace raw m loaded n]
  simp [sourceTrace, read]

#print axioms initialized_trace

end BoolTranslation.SourceReader
