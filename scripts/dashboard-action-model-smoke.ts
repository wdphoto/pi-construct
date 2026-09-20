import assert from "node:assert/strict";
import { checkboxPickerRemoveTargetIds, packageSubmitBlockedBySkillCarrier } from "../extensions/construct/picker-actions.js";

assert.deepEqual(checkboxPickerRemoveTargetIds([], undefined), []);
assert.deepEqual(checkboxPickerRemoveTargetIds([], "focused-package"), ["focused-package"]);
assert.deepEqual(checkboxPickerRemoveTargetIds(["selected-package"], "focused-package"), ["selected-package"]);
assert.deepEqual(checkboxPickerRemoveTargetIds(["child-a", "child-b"], "focused-package"), ["child-a", "child-b"]);

// Managed Agent Skills carriers use inline children, never a whole-package toggle; Available
// carriers still install through the parent row because their children are read-only.
assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Active", true), true);
assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Disabled", true), true);
assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Available", true), false);
assert.equal(packageSubmitBlockedBySkillCarrier("confirm", "package", "Available", false), false);
assert.equal(packageSubmitBlockedBySkillCarrier("remove", "package", "Active", true), false);

console.log("dashboard-action-model smoke ok");
