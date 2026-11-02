import SensorMachine

namespace BoolTranslation.SensorPairMachine
open ModuleEnvelope SensorMachine
set_option maxRecDepth 8192
set_option maxHeartbeats 4000000

def site (side : Bool) : Nat := if side then 12 else 7
def origin (side : Bool) : Nat := if side then 2 else 1

def code (side : Bool) : List Nat :=
  branch [3, if side then 4 else 1, 0] [3, if side then 3 else 0, 0] [1, 0] ++
  branch [3, if side then 4 else 1, 0] [32] [3, if side then 5 else 2, 0, 33, 19] ++
  branch [3, if side then 4 else 1, 0] [32] [32 + origin side] ++ [56] ++ u32 (site side)

def expected (side : Bool) : Reading → Bool × List Event
  | .healthy b => (b, [⟨site side, 0, 0⟩])
  | .fault fault => (false, [⟨site side, fault.code + 1, origin side⟩])

theorem healthy_execution (ops : NumberOps N) (laws : SmallNumberLaws ops) (side : Bool) (inputs : List (Value N)) (b : Bool)
    (hv : inputs[if side then 3 else 0]? = some (.bool b))
    (hok : inputs[if side then 4 else 1]? = some (.bool true)) :
    SensorMachine.run ops (code side) inputs = some (expected side (.healthy b)) := by
  have path : Steps ops (code side) inputs 13 ⟨0, [], []⟩
      ⟨45, [.bool b], [⟨site side, 0, 0⟩]⟩ := by
    apply Steps.next ⟨3, [.bool true], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨6, [], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨9, [.bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨14, [.bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨17, [.bool true, .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨20, [.bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨21, [.number (ops.literal 0), .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨29, [.number (ops.literal 0), .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨32, [.bool true, .number (ops.literal 0), .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨35, [.number (ops.literal 0), .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨36, [.number (ops.literal 0), .number (ops.literal 0), .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨40, [.number (ops.literal 0), .number (ops.literal 0), .bool b], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hv hok <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hv, hok]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨45, [.bool b], [⟨site side, 0, 0⟩]⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) ?_ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) Steps.refl
    cases side <;> simp [step, code, site, origin, branch, u16, u32, wordAt, dwordAt, laws.integer_literal 0 (by decide)]
  exact steps_execute path 46 (by decide) (by cases side <;> rfl) rfl

theorem fault_execution (ops : NumberOps N) (laws : SmallNumberLaws ops) (side : Bool) (inputs : List (Value N)) (fault : Fault)
    (hok : inputs[if side then 4 else 1]? = some (.bool false))
    (hf : inputs[if side then 5 else 2]? = some (.number (ops.literal fault.code))) :
    SensorMachine.run ops (code side) inputs = some (expected side (.fault fault)) := by
  have bound := fault_bound fault
  have choiceBound : fault.code + 1 ≤ 65535 := by omega
  have small : fault.code + 1 ≤ 4 := by omega
  have path : Steps ops (code side) inputs 12 ⟨0, [], []⟩
      ⟨45, [.bool false], [⟨site side, fault.code + 1, origin side⟩]⟩ := by
    apply Steps.next ⟨3, [.bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨12, [], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨14, [.bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨17, [.bool false, .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨24, [.bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨27, [.number (ops.literal fault.code), .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨28, [.number (ops.literal 1), .number (ops.literal fault.code), .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨29, [.number (ops.literal (fault.code + 1)), .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
      (by cases side <;> simp [step, code, origin, site, branch, u16, u32, laws.add_one fault.code bound]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨32, [.bool false, .number (ops.literal (fault.code + 1)), .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨39, [.number (ops.literal (fault.code + 1)), .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨40, [.number (ops.literal (origin side)), .number (ops.literal (fault.code + 1)), .bool false], []⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) (by cases side <;> simp at hok hf <;> simp [step, code, origin, site, branch, u16, u32, wordAt, hok, hf]) (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide))
    apply Steps.next ⟨45, [.bool false], [⟨site side, fault.code + 1, origin side⟩]⟩ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) ?_ (by cases side <;> first | decide | (dsimp [code, origin, site, branch, u16, u32]; decide)) Steps.refl
    cases side <;> simp [step, code, site, origin, branch, u16, u32, wordAt, dwordAt,
      laws.integer_literal 1 (by decide), laws.integer_literal 2 (by decide),
      laws.integer_literal (fault.code + 1) small, choiceBound]
  exact steps_execute path 46 (by decide) (by cases side <;> rfl) rfl


def pairRails (ops : NumberOps N) (left right : Reading) (leftStale rightStale : Bool) : List (Value N) :=
  rails ops left leftStale ++ rails ops right rightStale

theorem recovery (ops : NumberOps N) (laws : SmallNumberLaws ops) (side : Bool)
    (left right : Reading) (leftStale rightStale : Bool) :
    SensorMachine.run ops (code side) (pairRails ops left right leftStale rightStale) =
      some (expected side (if side then right else left)) := by
  cases side <;> cases left <;> cases right <;>
    first
    | apply healthy_execution ops laws <;> simp [pairRails, rails]
    | apply fault_execution ops laws <;> simp [pairRails, rails]

theorem paired_recovery (ops : NumberOps N) (laws : SmallNumberLaws ops)
    (left right : Reading) (leftStale rightStale : Bool) :
    (SensorMachine.run ops (code false) (pairRails ops left right leftStale rightStale),
     SensorMachine.run ops (code true) (pairRails ops left right leftStale rightStale)) =
      (some (expected false left), some (expected true right)) := by
  simp [recovery ops laws]

theorem false_distinguished (side : Bool) (fault : Fault) :
    expected side (.healthy false) ≠ expected side (.fault fault) := by
  cases side <;> simp [expected, origin]

#print axioms recovery
#print axioms paired_recovery
#print axioms false_distinguished
end BoolTranslation.SensorPairMachine
