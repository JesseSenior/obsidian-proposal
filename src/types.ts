export interface Comment {
	id: string;
	from: number;
	to: number;
	text: string;
}

export interface Proposal {
	version: 1;
	text: string;
	comments: Comment[];
}

export interface Snapshot {
	path: string;
	current: string;
	proposal: Proposal;
}

export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

export interface ReadRequest {
	path: string;
	startLine?: number;
	endLine?: number;
}

export interface EditRequest {
	patch?: string;
	removeComments?: Record<string, string[]>;
}

export interface ProposalIO {
	configDir: string;
	readCurrent(path: string): Promise<string>;
	writeCurrent(path: string, expected: string, text: string): Promise<void>;
	read(path: string): Promise<string | null>;
	write(path: string, text: string): Promise<void>;
	remove(path: string): Promise<void>;
	list(): Promise<string[]>;
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
