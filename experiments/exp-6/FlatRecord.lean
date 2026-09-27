import Lean

/-!
EXP-6 tests a small theorem about unordered canonical records and literal reads.
The model is intentionally independent of EXP-2's TypeScript representation.
-/

namespace Exp6

/-- A key is the sequence of UTF-16 code units used by JavaScript property names. -/
abbrev Key := List UInt16

/-- Scalar tags preserve the distinctions relevant to literal value observations.
Text contains Unicode scalar values only, not lone surrogates; numeric tokens are
opaque and translation must validate their canonical spelling. -/
inductive Atom where
  | undefined
  | null
  | boolean (value : Bool)
  | text (value : String)
  | number (canonicalToken : String)
  deriving DecidableEq, Repr

/-- One supported own data field; record order is observable only by a separate keys operation. -/
structure Entry where
  key : Key
  value : Atom
  deriving DecidableEq, Repr

/-- Duplicate keys are outside the input domain because a lossy parser cannot recover them. -/
def UniqueKeys (entries : List Entry) : Prop := (entries.map Entry.key).Nodup

/-- Compare UTF-16 code units lexicographically, matching JavaScript's string-key sort. -/
def keyLE : Key → Key → Bool
  | [], _ => true
  | _ :: _, [] => false
  | left :: leftTail, right :: rightTail =>
    if left == right then keyLE leftTail rightTail else decide (left < right)

/-- Canonical equality discards only record-entry insertion order. -/
def normalForm (entries : List Entry) : List Entry :=
  entries.mergeSort (fun left right => keyLE left.key right.key)

/-- Literal value selection returns `undefined` for a missing own field. -/
def readValue (entries : List Entry) (key : Key) : Atom :=
  match entries.find? (fun entry => entry.key == key) with
  | some entry => entry.value
  | none => .undefined

/-- Own presence is separate from a value read, including a present `undefined`. -/
def readOwn (entries : List Entry) (key : Key) : Bool :=
  entries.any (fun entry => entry.key == key)

/-- Uniqueness makes a property lookup a single fact, not a choice among duplicates. -/
private theorem same_key_entry
    (entries : List Entry) (unique : UniqueKeys entries)
    (first second : Entry) (firstMem : first ∈ entries)
    (secondMem : second ∈ entries) (sameKey : first.key = second.key) :
    first = second := by
  induction entries with
  | nil => cases firstMem
  | cons head tail ih =>
    simp only [UniqueKeys, List.map_cons, List.nodup_cons] at unique
    simp only [List.mem_cons] at firstMem secondMem
    have tailUnique : UniqueKeys tail := unique.2
    grind

/-- A permutation cannot change selected data when every key identifies one entry. -/
private theorem find_key_of_permutation
    (left right : List Entry) (leftUnique : UniqueKeys left)
    (sameEntries : left.Perm right) (key : Key) :
    left.find? (fun entry => entry.key == key) =
      right.find? (fun entry => entry.key == key) := by
  cases leftFound : left.find? (fun entry => entry.key == key) with
  | none =>
    symm
    apply List.find?_eq_none.mpr
    intro entry inRight matched
    exact (List.find?_eq_none.mp leftFound) entry
      ((sameEntries.mem_iff).mpr inRight) matched
  | some first =>
    have firstInRight : first ∈ right :=
      (sameEntries.mem_iff).mp (List.mem_of_find?_eq_some leftFound)
    have firstMatches : (first.key == key) = true :=
      List.find?_some (p := fun entry : Entry => entry.key == key) leftFound
    have firstKey : first.key = key :=
      LawfulBEq.eq_of_beq firstMatches
    cases rightFound : right.find? (fun entry => entry.key == key) with
    | none =>
      have missing := (List.find?_eq_none.mp rightFound) first firstInRight
      exact False.elim (missing (beq_iff_eq.mpr firstKey))
    | some second =>
      have secondInLeft : second ∈ left :=
        (sameEntries.mem_iff).mpr (List.mem_of_find?_eq_some rightFound)
      have secondMatches : (second.key == key) = true :=
        List.find?_some (p := fun entry : Entry => entry.key == key) rightFound
      have secondKey : second.key = key :=
        LawfulBEq.eq_of_beq secondMatches
      have sameEntry := same_key_entry left leftUnique first second
        (List.mem_of_find?_eq_some leftFound) secondInLeft
        (firstKey.trans secondKey.symm)
      simpa [leftFound, rightFound] using congrArg some sameEntry

/-- The theorem target is equality of the two literal facts at one Property path.
Its proof must not redefine either read in terms of the sorted normal form. -/
theorem equal_normal_form_preserves_property_reads
    (left right : List Entry)
    (leftUnique : UniqueKeys left)
    (_rightUnique : UniqueKeys right)
    (equalNormal : normalForm left = normalForm right)
    (key : Key) :
    readValue left key = readValue right key ∧ readOwn left key = readOwn right key := by
  have leftSorted : (normalForm left).Perm left :=
    List.mergeSort_perm left (fun a b => keyLE a.key b.key)
  have rightSorted : (normalForm right).Perm right :=
    List.mergeSort_perm right (fun a b => keyLE a.key b.key)
  have aligned : (normalForm left).Perm right := by
    rw [equalNormal]
    exact rightSorted
  have sameEntries : left.Perm right := leftSorted.symm.trans aligned
  constructor
  · simp only [readValue]
    rw [find_key_of_permutation left right leftUnique sameEntries key]
  · exact sameEntries.any_eq

-- Keep proof assumptions visible to reviewers alongside the checked theorem.
#print axioms equal_normal_form_preserves_property_reads

/-- Reverse insertion preserves normalized equality but changes explicit key order. -/
private def reverseRecord : List Entry :=
  [{ key := [98], value := .number "2" }, { key := [97], value := .number "1" }]

/-- The forward peer is an independent insertion history of the same own fields. -/
private def forwardRecord : List Entry :=
  [{ key := [97], value := .number "1" }, { key := [98], value := .number "2" }]

example : normalForm reverseRecord = normalForm forwardRecord := by
  simp [normalForm, reverseRecord, forwardRecord, List.mergeSort, keyLE]
example : (reverseRecord.map Entry.key) ≠ (forwardRecord.map Entry.key) := by decide
example : readValue [] [120] = readValue [{ key := [120], value := .undefined }] [120] := by decide
example : readOwn [] [120] ≠ readOwn [{ key := [120], value := .undefined }] [120] := by decide
example : readValue [{ key := [120], value := .number "0" }] [120] ≠
    readValue [{ key := [120], value := .text "" }] [120] := by decide

/-- A small key vocabulary exercises order, numeric spelling and punctuation. -/
private def oracleKeys : List Key := [[97], [98], [48], [97, 46, 98]]

/-- Opaque atom cases challenge undefined, null, booleans, strings and signed zero. -/
private def oracleAtoms : List Atom :=
  [.undefined, .null, .boolean false, .text "", .number "0", .number "-0"]

/-- The generated corpus is bounded to at most two distinct own fields. -/
private def oracleRecords : List (List Entry) :=
  let singles := oracleKeys.flatMap fun key =>
    oracleAtoms.map fun value => [{ key := key, value := value }]
  let pairs := oracleKeys.flatMap fun firstKey =>
    (oracleKeys.filter (· != firstKey)).flatMap fun secondKey =>
      oracleAtoms.flatMap fun firstValue =>
        oracleAtoms.map fun secondValue =>
          [{ key := firstKey, value := firstValue }, { key := secondKey, value := secondValue }]
  [[]] ++ singles ++ pairs

/-- Transport keys as code units so JavaScript string conversion is explicit in the test bridge. -/
private def keyJson (key : Key) : Lean.Json :=
  .arr ((key.map fun unit => Lean.toJson unit.toNat).toArray)

/-- The oracle transports atom tags rather than JavaScript coercions or truthiness. -/
private def atomJson : Atom → Lean.Json
  | .undefined => .mkObj [("kind", .str "undefined")]
  | .null => .mkObj [("kind", .str "null")]
  | .boolean value => .mkObj [("kind", .str "boolean"), ("value", Lean.toJson value)]
  | .text value => .mkObj [("kind", .str "text"), ("value", .str value)]
  | .number token => .mkObj [("kind", .str "number"), ("value", .str token)]

/-- Emit one data field without depending on EXP-2's wire grammar. -/
private def entryJson (entry : Entry) : Lean.Json :=
  .arr #[keyJson entry.key, atomJson entry.value]

/-- Independent expected facts accompany the source and its normalized order. -/
private def caseJson (entries : List Entry) (key : Key) : Lean.Json :=
  .mkObj [
    ("entries", .arr ((entries.map entryJson).toArray)),
    ("normal", .arr (((normalForm entries).map entryJson).toArray)),
    ("key", keyJson key),
    ("value", atomJson (readValue entries key)),
    ("own", Lean.toJson (readOwn entries key))
  ]

/-- The executable finite oracle samples the theorem's input domain for TypeScript comparison. -/
def runOracle : IO Unit := do
  for entries in oracleRecords do
    for key in oracleKeys ++ [[120]] do
      IO.println s!"CASE {(caseJson entries key).compress}"

end Exp6

/-- Lean checks the theorem before emitting independently generated comparison cases. -/
def main : IO Unit := Exp6.runOracle
