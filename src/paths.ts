export interface PathChange {
	oldPath: string;
	newPath?: string;
	folder: boolean;
}

export function matchesPath(path: string, change: PathChange): boolean {
	return path === change.oldPath || change.folder && path.startsWith(`${change.oldPath}/`);
}
