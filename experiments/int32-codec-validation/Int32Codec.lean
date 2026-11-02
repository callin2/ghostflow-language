import Std

namespace Int32Codec

def inRange (n : Int) : Prop := -2147483648 ≤ n ∧ n < 2147483648

-- Two's complement representative, split into base-256 little-endian digits.
def unsigned (n : Int) : Nat :=
  (if n < 0 then n + 4294967296 else n).toNat

def encodeUnsigned (u : Nat) : List Nat :=
  [u % 256, u / 256 % 256, u / 65536 % 256, u / 16777216]

def encode (n : Int) : List Nat := encodeUnsigned (unsigned n)

def signed (u : Nat) : Int :=
  if u < 2147483648 then (u : Int) else (u : Int) - 4294967296

def decode : List Nat → Option Int
  | [a, b, c, d] =>
    if a < 256 ∧ b < 256 ∧ c < 256 ∧ d < 256 then
      some (signed (a + 256*b + 65536*c + 16777216*d))
    else none
  | _ => none

theorem unsigned_bounds (n : Int) (h : inRange n) :
    unsigned n < 4294967296 := by
  unfold unsigned inRange at *
  split <;> omega

theorem unsigned_value (n : Int) (h : inRange n) :
    (unsigned n : Int) = if n < 0 then n + 4294967296 else n := by
  unfold unsigned inRange at *
  split <;> omega

theorem unsigned_digits (u : Nat) :
    u % 256 + 256 * (u / 256 % 256) + 65536 * (u / 65536 % 256) +
      16777216 * (u / 16777216) = u := by
  omega

theorem encoded_length (n : Int) : (encode n).length = 4 := by rfl

theorem encoded_bytes (n : Int) (h : inRange n) :
    ∀ b ∈ encode n, b < 256 := by
  have hu := unsigned_bounds n h
  intro b hb
  simp only [encode, encodeUnsigned, List.mem_cons, List.not_mem_nil, or_false] at hb
  rcases hb with rfl | rfl | rfl | rfl <;> omega

theorem signed_unsigned (n : Int) (h : inRange n) : signed (unsigned n) = n := by
  have hv := unsigned_value n h
  unfold signed inRange at *
  split <;> split at hv <;> omega

theorem roundtrip (n : Int) (h : inRange n) : decode (encode n) = some n := by
  have hu := unsigned_bounds n h
  have hd := unsigned_digits (unsigned n)
  have hb := encoded_bytes n h
  simp only [encode, encodeUnsigned, List.mem_cons, List.not_mem_nil, or_false] at hb
  simp only [encode, encodeUnsigned, decode]
  have bounds : unsigned n % 256 < 256 ∧ unsigned n / 256 % 256 < 256 ∧
      unsigned n / 65536 % 256 < 256 ∧ unsigned n / 16777216 < 256 := by omega
  simp [bounds, hd, signed_unsigned n h]

theorem decode_range (bs : List Nat) (n : Int) (h : decode bs = some n) :
    inRange n := by
  unfold decode at h
  split at h <;> simp_all
  rename_i a b c d
  obtain ⟨bounds, h⟩ := h
  unfold signed at h
  split at h <;> simp_all
  all_goals unfold inRange; omega

theorem encode_injective (m n : Int) (hm : inRange m) (hn : inRange n)
    (h : encode m = encode n) : m = n := by
  have a := roundtrip m hm
  have b := roundtrip n hn
  rw [h, b] at a
  exact (Option.some.inj a).symm

theorem signed_boundary (u : Nat) (h : u < 4294967296) :
    (signed u < 0 ↔ 2147483648 ≤ u) ∧
    (0 ≤ signed u ↔ u < 2147483648) := by
  unfold signed
  split <;> omega

theorem unsigned_signed (u : Nat) (h : u < 4294967296) :
    unsigned (signed u) = u := by
  unfold unsigned signed
  split <;> split <;> omega

theorem decode_canonical (bs : List Nat) (n : Int) (h : decode bs = some n) :
    encode n = bs := by
  unfold decode at h
  split at h <;> simp_all
  rename_i a b c d
  obtain ⟨bounds, rfl⟩ := h
  have hu : a + 256*b + 65536*c + 16777216*d < 4294967296 := by omega
  simp only [encode, unsigned_signed _ hu, encodeUnsigned]
  have ha : (a + 256*b + 65536*c + 16777216*d) % 256 = a := by omega
  have hb : (a + 256*b + 65536*c + 16777216*d) / 256 % 256 = b := by omega
  have hc : (a + 256*b + 65536*c + 16777216*d) / 65536 % 256 = c := by omega
  have hd : (a + 256*b + 65536*c + 16777216*d) / 16777216 = d := by omega
  rw [ha, hb, hc, hd]

theorem decode_unique (a b : List Nat) (n : Int)
    (ha : decode a = some n) (hb : decode b = some n) : a = b := by
  rw [← decode_canonical a n ha, ← decode_canonical b n hb]

#print axioms roundtrip
#print axioms encoded_bytes
#print axioms decode_range
#print axioms encode_injective
#print axioms signed_boundary
#print axioms decode_canonical
#print axioms decode_unique

end Int32Codec
