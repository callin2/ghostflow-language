import SensorProfile
import SensorPairMachine

namespace BoolTranslation.PairModule
open ModuleEnvelope ModuleLoader SensorProfile SensorPairMachine SensorMachine

structure Parsed where
  name : List Nat
  inputs : List (List Nat × Nat)
  capabilities : List Nat
  outputs : List (List Nat × Nat × List Nat)
  deriving DecidableEq

def readOutput : Reader (List Nat × Nat × List Nat) := do
  let name ← readName
  let type ← readByte
  let code ← readBlob
  pure (name, type, code)

def readHeader : Reader (List Nat × List (List Nat × Nat)) := do
  let magic ← readBytes 6
  require (magic = [71, 70, 66, 49, 3, 0])
  let name ← readName
  let version ← readU32
  let inputCount ← readU16
  require (version = 1 ∧ inputCount = 6)
  let inputs ← readMany SensorProfile.readInput 6
  let states ← readU16
  require (states = 0)
  pure (name, inputs)

def readStrategy : Reader (List Nat) := do
  let strategies ← readU16
  let strategy ← readName
  let priority ← readU32
  let capabilities ← readBlob
  let transitions ← readU16
  let outputCount ← readU16
  require (strategies = 1 ∧ strategy = ascii "control" ∧ priority = 0 ∧
    transitions = 0 ∧ outputCount = 2)
  pure capabilities

def readRaw : Reader Parsed := do
  let (name, inputs) ← readHeader
  let capabilities ← readStrategy
  let outputs ← readMany readOutput 2
  let constraints ← readU16
  require (constraints = 0)
  pure ⟨name, inputs, capabilities, outputs⟩

-- Each run starts with an empty expression trace. This is a pair of evaluations,
-- not a model of the Rust scan's trace collector.
def evaluate (ops : NumberOps N) (raw : List Nat) (inputs : List (Value N)) :
    Option (Option (Bool × List Event) × Option (Bool × List Event)) := do
  let (m, tail) ← readRaw raw
  if tail ≠ [] then none else
    match m.outputs with
    | [(_, 1, left), (_, 1, right)] =>
      some (SensorMachine.run ops left inputs, SensorMachine.run ops right inputs)
    | _ => none

end BoolTranslation.PairModule
