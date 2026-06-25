import assert from "node:assert/strict";
import { checkboxPickerRemoveTargetIds } from "../extensions/construct/picker-actions.js";

assert.deepEqual(checkboxPickerRemoveTargetIds([], undefined), []);
assert.deepEqual(checkboxPickerRemoveTargetIds([], "focused-package"), ["focused-package"]);
assert.deepEqual(checkboxPickerRemoveTargetIds(["selected-package"], "focused-package"), ["selected-package"]);
assert.deepEqual(checkboxPickerRemoveTargetIds(["child-a", "child-b"], "focused-package"), ["child-a", "child-b"]);

console.log("dashboard-action-model smoke ok");
