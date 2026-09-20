export function checkboxPickerRemoveTargetIds(checkedIds: Iterable<string>, focusedId: string | undefined): string[] {
	const checked = [...checkedIds];
	return checked.length > 0 ? checked : focusedId ? [focusedId] : [];
}

/**
 * Skill carriers manage their resources through inline children, not a whole-package toggle.
 * Available carriers are the exception: their children are read-only until install, so the
 * parent Enter must still install the package normally.
 */
export function packageSubmitBlockedBySkillCarrier(submitAction: string, type: string, section: string | undefined, isSkillCarrier: boolean): boolean {
	return submitAction === "confirm" && type === "package" && isSkillCarrier && section !== "Available";
}
