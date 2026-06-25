export function checkboxPickerRemoveTargetIds(checkedIds: Iterable<string>, focusedId: string | undefined): string[] {
	const checked = [...checkedIds];
	return checked.length > 0 ? checked : focusedId ? [focusedId] : [];
}
